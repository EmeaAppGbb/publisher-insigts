"""An in-memory Eventhouse for the offline tests of ComputeBookSignals.

The stand-in answers what the notebook calls, with the semantics it relies on: Fabric REST's list of the current
workspace's KQL databases, and the Kusto REST v1 endpoint they share. BookSignals' tables are the ones the repository's
DatabaseSchema.kql creates. The endpoint answers `.show databases` in either form Fabric can give, the queries the
notebook runs, and ingest-from-query `.append` commands: it decodes their base64 JSON rows, refuses a projection that
differs from the table's columns, converts each value as KQL does (tostring of a null is an empty string) and fails,
as Kusto does, an append whose ingestIfNotExists tag the table already holds.
"""

import base64
import datetime
import json
import re

from _support import WORKSPACE, WORKSPACE_ID

KQL_DATABASE_ID = "77777777-7777-4777-8777-777777777777"
DEFAULT_DATABASE_ID = "88888888-8888-4888-8888-888888888888"
EVENTHOUSE_ID = "99999999-9999-4999-8999-999999999999"
QUERY_URI = "https://example-eventhouse.z0.kusto.fabric.microsoft.com"
SCHEMA = WORKSPACE / "BookSignals.KQLDatabase" / "DatabaseSchema.kql"
UTC = datetime.timezone.utc
CONVERSIONS = {"string": "tostring", "long": "tolong", "real": "toreal", "datetime": "todatetime"}
DOTNET = {"string": "String", "long": "Int64", "real": "Double", "datetime": "DateTime", "bool": "Boolean"}
SHOW_DATABASES = (("DatabaseName", "string"), ("PersistentStorage", "string"), ("Version", "string"),
                  ("IsCurrent", "bool"), ("DatabaseAccessMode", "string"), ("PrettyName", "string"))
EXTENTS = (("ExtentId", "string"), ("OriginalSize", "real"), ("ExtentSize", "real"), ("CompressedSize", "real"),
           ("IndexSize", "real"), ("RowCount", "long"))
APPEND = re.compile(
    r"\.append (\w+) with \(ingestIfNotExists = '\[\"([\w-]+)\"\]', tags = '\[\"ingest-by:([\w-]+)\"\]'\) <\| "
    r"print r = parse_json\(base64_decode_tostring\('([A-Za-z0-9+/=]+)'\)\)( \| mv-expand r)? \| project (.+)")
PROJECTION = re.compile(r"\['(\w+)'\] = (tostring|tolong|toreal|todatetime)\(r\['(\w+)'\]\)")
TIMESTAMP = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z")


def kql_tables():
    """DatabaseSchema.kql's tables: each name's (column, type) pairs, in order."""
    text = SCHEMA.read_text(encoding="utf-8")
    return {name: re.findall(r"(\w+):(\w+)", columns)
            for name, columns in re.findall(r"(?m)^\.create-merge table (\w+) \(([^)]*)\)$", text)}


def kql_item(item_id, name):
    """A KQL database as Fabric REST lists it."""
    return {"id": item_id, "type": "KQLDatabase", "displayName": name, "workspaceId": WORKSPACE_ID,
            "properties": {"parentEventhouseItemId": EVENTHOUSE_ID, "queryServiceUri": QUERY_URI,
                           "ingestionServiceUri": QUERY_URI.replace("https://", "https://ingest-"),
                           "databaseType": "ReadWrite"}}


def convert(value, kind):
    """A JSON value through the column's KQL conversion; the notebook must send each type as JSON of that type."""
    if kind == "string":
        assert value is None or isinstance(value, str), value
        return value or ""
    if value is None:
        return None
    if kind == "long":
        assert type(value) is int, value
        return value
    if kind == "real":
        assert type(value) in (int, float), value
        return float(value)
    assert kind == "datetime" and isinstance(value, str), (kind, value)
    if re.fullmatch(r"\d{4}-\d\d-\d\d", value):
        return datetime.datetime.combine(datetime.date.fromisoformat(value), datetime.time(), UTC)
    assert TIMESTAMP.fullmatch(value), value
    return datetime.datetime.strptime(value[:26].rstrip("Z"), "%Y-%m-%dT%H:%M:%S.%f" if "." in value
                                      else "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC)


def serialized(value):
    """A stored value as a v1 response writes it: datetimes in UTC with seven fractional digits."""
    if isinstance(value, datetime.datetime):
        return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f") + "0Z"
    return value


class Response:
    def __init__(self, status_code, body=None, headers=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.body = body
        self.text = "" if body is None else json.dumps(body)

    def json(self):
        return self.body


def result(columns, rows):
    """A v1 response whose first table is the result."""
    return Response(200, {"Tables": [{
        "TableName": "Table_0",
        "Columns": [{"ColumnName": name, "DataType": DOTNET[kind], "ColumnType": kind} for name, kind in columns],
        "Rows": [[serialized(value) for value in row] for row in rows]}]})


def failure(status, message):
    return Response(status, {"error": {"code": "BadRequest" if status < 500 else "ServiceUnavailable",
                                       "message": message}}, {"Retry-After": "0"} if status == 429 else None)


class Eventhouse:
    """BookEvents in memory: the KQL databases Fabric lists in the current workspace and their Kusto endpoint.

    `database_name` is the name `.show databases` gives BookSignals: by default its item ID, with the display name as
    its PrettyName, or the display name itself, with an empty PrettyName. `failures` maps the start of a command to
    the HTTP statuses its next requests get, one each. `calls` records every request as (endpoint, db, csl).
    """

    def __init__(self, database_name=KQL_DATABASE_ID):
        self.items = [kql_item(DEFAULT_DATABASE_ID, "BookEvents"), kql_item(KQL_DATABASE_ID, "BookSignals")]
        by_id = database_name == KQL_DATABASE_ID
        # An Eventhouse created through the API gets a default database named like the Eventhouse.
        self.databases = [(DEFAULT_DATABASE_ID, "BookEvents") if by_id else ("BookEvents", ""),
                          (database_name, "BookSignals" if by_id else "")]
        self.database = database_name
        self.tables = {name: {"columns": columns, "rows": [], "tags": set()} for name, columns in kql_tables().items()}
        self.failures, self.calls = {}, []

    def add(self, table, row):
        """Store a row as a writer other than the notebook, the reprint server, would."""
        assert list(row) == [name for name, _ in self.tables[table]["columns"]], list(row)
        self.tables[table]["rows"].append(dict(row))

    def rows(self, table):
        return [dict(row) for row in self.tables[table]["rows"]]

    def request(self, method, url, headers=None, timeout=None, allow_redirects=None, params=None, json=None):
        assert allow_redirects is False and 0 < timeout <= 120, (allow_redirects, timeout)
        if url == f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/kqlDatabases":
            assert (method, headers["Authorization"], params) == ("GET", "Bearer pbi-token", {}), (method, params)
            self.calls.append(("fabric", None, url))
            return Response(200, {"value": self.items})
        endpoint = url.rsplit("/", 1)[-1]
        assert (method, url) == ("POST", f"{QUERY_URI}/v1/rest/{endpoint}") and endpoint in ("query", "mgmt"), url
        assert headers["Authorization"] == "Bearer kusto-token", "Kusto takes the user's Kusto token"
        database, csl = json.get("db"), json["csl"]
        self.calls.append((endpoint, database, csl))
        for prefix, statuses in self.failures.items():
            if csl.startswith(prefix) and statuses:
                return failure(statuses.pop(0), f"Injected failure for {prefix}")
        if (endpoint, csl) == ("mgmt", ".show databases"):
            assert database is None, ".show databases is cluster-scoped"
            return result(SHOW_DATABASES, [(name, "", "v1.0", False, "ReadWrite", pretty)
                                           for name, pretty in self.databases])
        if database != self.database:
            return failure(400, f"Entity ID '{database}' of kind 'Database' was not found.")
        return self.append(csl) if endpoint == "mgmt" else self.query(csl)

    def query(self, csl):
        projected = re.fullmatch(r"(\w+) \| project (\w+(?:, \w+)*)", csl)
        if projected:
            table, names = self.tables[projected[1]], projected[2].split(", ")
            kinds = dict(table["columns"])
            return result([(name, kinds[name]) for name in names],
                          [[row[name] for name in names] for row in table["rows"]])
        counted = re.fullmatch(r"(\w+) \| where run_id == '([0-9a-f-]{36})' \| count", csl)
        assert counted, f"unexpected Kusto query: {csl[:200]}"
        rows = self.tables[counted[1]]["rows"]
        return result([("Count", "long")], [[sum(1 for row in rows if row["run_id"] == counted[2])]])

    def append(self, csl):
        command = APPEND.fullmatch(csl)
        assert command, f"unexpected Kusto command: {csl[:200]}"
        name, tag, ingest_by, data, expand, projection = command.groups()
        assert tag == ingest_by, (tag, ingest_by)
        table = self.tables[name]
        if tag in table["tags"]:
            return failure(400, f"ingestIfNotExists: {name} already has data tagged ingest-by:{tag}.")
        # Kusto matches the result to the table by position and type, so the projection must be its columns in order.
        parts = [PROJECTION.fullmatch(part) for part in projection.split(", ")]
        assert all(parts) and all(part[1] == part[3] for part in parts), projection
        expected = [(column, CONVERSIONS[kind]) for column, kind in table["columns"]]
        assert [(part[1], part[2]) for part in parts] == expected, projection
        value = json.loads(base64.b64decode(data, validate=True).decode("utf-8"))
        records = value if expand else [value]
        assert isinstance(value, list) if expand else isinstance(value, dict), "mv-expand an array, print one object"
        rows = []
        for record in records:
            assert sorted(record) == sorted(column for column, _ in table["columns"]), sorted(record)
            rows.append({column: convert(record[column], kind) for column, kind in table["columns"]})
        table["rows"].extend(rows)
        table["tags"].add(tag)
        return result(EXTENTS, [(f"extent-{len(table['tags'])}", 1.0, 1.0, 1.0, 1.0, len(rows))])
