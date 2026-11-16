"""An in-memory lakehouse for the offline tests of the Books notebooks.

The stand-ins implement only what SeedBooks and ComputeBookSignals call, with the semantics they rely on: typed
schemas that refuse a value of the wrong type as Spark does (an int for a DOUBLE, a datetime for a DATE),
errorifexists and overwrite writes, Delta's insert-only merge on the key columns, reads of a table's current rows,
and notebookutils.fs files that are never overwritten and need their folder to exist.
"""

import datetime
import re
import types

from _support import LAKEHOUSE_ID, WORKSPACE_ID

LAKEHOUSE_PATH = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
TABLES = f"{LAKEHOUSE_PATH}/Tables/dbo"
FILES = f"{LAKEHOUSE_PATH}/Files"
TYPES = {"STRING": (str,), "BIGINT": (int,), "DOUBLE": (float,), "DATE": (datetime.date,),
         "TIMESTAMP": (datetime.datetime,)}


class Schema:
    """A Spark schema from a DDL string: `name TYPE, ...`."""

    def __init__(self, ddl):
        self.ddl = ddl
        self.columns = re.findall(r"(\w+) (STRING|BIGINT|DOUBLE|DATE|TIMESTAMP)", ddl)
        assert ", ".join(f"{name} {kind}" for name, kind in self.columns) == ddl, ddl

    @property
    def names(self):
        return [name for name, _ in self.columns]

    def simpleString(self):
        return "struct<" + ",".join(f"{name}:{kind.lower()}" for name, kind in self.columns) + ">"

    def check(self, row):
        assert len(row) == len(self.columns), (self.ddl, row)
        for (name, kind), value in zip(self.columns, row):
            if value is None:
                continue
            exact = type(value) is datetime.date if kind == "DATE" else isinstance(value, TYPES[kind])
            if not exact or type(value) is bool:
                raise TypeError(f"field {name}: {kind} can not accept object {value!r} in type {type(value)}")


class Row:
    def __init__(self, names, values):
        self.names, self.values = names, values

    def asDict(self):
        return dict(zip(self.names, self.values))


class Frame:
    def __init__(self, lake, schema, rows):
        self.lake, self.schema, self.rows = lake, schema, rows

    @property
    def write(self):
        return Writer(self)

    def alias(self, name):
        assert name == "source"
        return self

    def collect(self):
        return [Row(self.schema.names, row) for row in self.rows]


class Writer:
    def __init__(self, frame):
        self.frame, self.settings = frame, []

    def format(self, name):
        self.settings.append(("format", name))
        return self

    def mode(self, name):
        self.settings.append(("mode", name))
        return self

    def save(self, path):
        assert self.settings[0] == ("format", "delta") and len(self.settings) == 2, self.settings
        lake, mode = self.frame.lake, self.settings[1][1]
        if mode == "errorifexists":
            if lake.exists(path):
                raise RuntimeError(f"[PATH_ALREADY_EXISTS] {path}")
            lake.log.append(("create", path))
        else:
            assert mode == "overwrite", mode
            # Delta refuses an overwrite that changes the schema unless overwriteSchema is set.
            if lake.tables[path]["ddl"] != self.frame.schema.ddl:
                raise RuntimeError(f"[DELTA_METADATA_MISMATCH] {path}")
            lake.log.append(("overwrite", path))
        lake.tables[path] = {"ddl": self.frame.schema.ddl, "rows": list(self.frame.rows)}


class Reader:
    def __init__(self, lake):
        self.lake, self.kind = lake, None

    def format(self, name):
        self.kind = name
        return self

    def load(self, path):
        assert self.kind == "delta" and path in self.lake.tables, path
        table = self.lake.tables[path]
        return Frame(self.lake, Schema(table["ddl"]), list(table["rows"]))


class DeltaTable:
    """delta.tables.DeltaTable over the lake's tables: isDeltaTable, forPath and an insert-only merge."""

    def __init__(self, lake, path):
        self.lake, self.path = lake, path

    @staticmethod
    def isDeltaTable(spark, path):
        return path in spark.lake.tables

    @classmethod
    def forPath(cls, spark, path):
        assert path in spark.lake.tables, path
        return cls(spark.lake, path)

    def toDF(self):
        table = self.lake.tables[self.path]
        return Frame(self.lake, Schema(table["ddl"]), list(table["rows"]))

    def alias(self, name):
        assert name == "target"
        return self

    def merge(self, source, condition):
        return Merge(self, source, condition)


class Merge:
    def __init__(self, target, source, condition):
        self.target, self.source, self.inserting = target, source, False
        self.keys = tuple(re.findall(r"target\.(\w+) = source\.\1", condition))
        assert condition == " AND ".join(f"target.{key} = source.{key}" for key in self.keys), condition

    def whenNotMatchedInsertAll(self):
        self.inserting = True
        return self

    def execute(self):
        assert self.inserting, "only whenNotMatchedInsertAll merges are insert-only"
        table = self.target.lake.tables[self.target.path]
        positions = [Schema(table["ddl"]).names.index(key) for key in self.keys]
        present = {tuple(row[index] for index in positions) for row in table["rows"]}
        inserted = 0
        for row in self.source.rows:
            key = tuple(row[index] for index in positions)
            if key not in present:
                table["rows"].append(row)
                present.add(key)
                inserted += 1
        self.target.lake.log.append(("merge", self.target.path, self.keys, inserted))


class Lake:
    """One lakehouse in memory: notebookutils.fs over its files and folders, and its Delta tables by path."""

    def __init__(self):
        self.files, self.directories, self.tables, self.log = {}, set(), {}, []

    def exists(self, path):
        return path in self.files or path in self.directories or path in self.tables

    def mkdirs(self, path):
        self.directories.add(path)
        self.log.append(("mkdirs", path))
        return True

    def put(self, path, content, overwrite):
        assert path.rsplit("/", 1)[0] in self.directories, f"no folder for {path}"
        if path in self.files and not overwrite:
            raise FileExistsError(path)
        self.files[path] = content
        self.log.append(("put", path))
        return True

    def rows(self, name):
        """A table's rows as dictionaries."""
        table = self.tables[f"{TABLES}/{name}"]
        names = Schema(table["ddl"]).names
        return [dict(zip(names, row)) for row in table["rows"]]


class Spark:
    def __init__(self, lake):
        self.lake = lake

    @property
    def read(self):
        return Reader(self.lake)

    def createDataFrame(self, data, schema):
        schema = Schema(schema)
        rows = [tuple(row) for row in data]
        for row in rows:
            schema.check(row)
        return Frame(self.lake, schema, rows)


def modules(lake, workspace_name="books-dev", lakehouse_workspace=WORKSPACE_ID, lakehouse_name="Books"):
    """notebookutils, pyspark.sql and delta.tables as the Books notebooks import them."""
    spark = Spark(lake)

    def get(name, workspace):
        if (name, workspace) != (lakehouse_name, WORKSPACE_ID):
            raise LookupError(f"no lakehouse {name} in workspace {workspace}")
        return types.SimpleNamespace(id=LAKEHOUSE_ID, workspaceId=lakehouse_workspace, displayName=name)

    context = {"currentWorkspaceId": WORKSPACE_ID, "currentWorkspaceName": workspace_name}
    sql = types.SimpleNamespace(SparkSession=types.SimpleNamespace(builder=types.SimpleNamespace(getOrCreate=lambda: spark)))
    tables = types.SimpleNamespace(DeltaTable=DeltaTable)
    return {"notebookutils": types.SimpleNamespace(runtime=types.SimpleNamespace(context=context),
                                                   lakehouse=types.SimpleNamespace(get=get), fs=lake),
            "pyspark": types.SimpleNamespace(sql=sql), "pyspark.sql": sql,
            "delta": types.SimpleNamespace(tables=tables), "delta.tables": tables}
