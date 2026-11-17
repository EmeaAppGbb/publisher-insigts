"""PublishBooksKnowledge, run locally against the in-memory lakehouse (see _lake)."""

import hashlib
import importlib.util
import subprocess
import sys
import unittest
from unittest import mock

import _support
from _lake import FILES, Lake, modules
from _support import OTHER_ID, ROOT, run

DOCUMENTS = f"{FILES}/documents"
SOURCES = ROOT / "scenario" / "knowledge"
GENERATOR = ROOT / ".github" / "skills" / "fabric-workspace" / "scripts" / "embed_knowledge.py"


def publish(lake, parameters=None, **context):
    """Every cell of PublishBooksKnowledge against `lake`; returns (namespace, printed output)."""
    return run("PublishBooksKnowledge", modules(lake, **context), parameters)


def approved():
    """The reviewed documents by file name, as their exact text."""
    return {path.name: path.read_bytes().decode("utf-8")
            for path in sorted(SOURCES.glob("*.md")) if path.name != "README.md"}


class PublishTests(unittest.TestCase):
    def test_the_notebook_embeds_exactly_the_reviewed_documents_and_their_digests(self):
        namespace, _ = publish(Lake())
        self.assertEqual({name: text for name, (_, text) in namespace["DOCUMENTS"].items()}, approved())
        for name, (digest, _) in namespace["DOCUMENTS"].items():
            self.assertEqual(digest, hashlib.sha256((SOURCES / name).read_bytes()).hexdigest(), name)
        check = subprocess.run([sys.executable, "-B", str(GENERATOR), "--check"], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_a_first_run_writes_every_document(self):
        lake = Lake()
        _, output = publish(lake)
        self.assertEqual(lake.files, {f"{DOCUMENTS}/{name}": text for name, text in approved().items()})
        self.assertIn(f"Published {len(approved())} of {len(approved())} approved documents", output)

    def test_a_rerun_writes_nothing_and_leaves_other_files_alone(self):
        lake = Lake()
        publish(lake)
        lake.files[f"{DOCUMENTS}/starter.txt"] = "seeded starter"
        start = len(lake.log)
        _, output = publish(lake)
        self.assertEqual(lake.log[start:], [])
        self.assertIn(f"Published 0 of {len(approved())}", output)
        self.assertEqual(lake.files[f"{DOCUMENTS}/starter.txt"], "seeded starter")

    def test_only_a_missing_document_is_written(self):
        lake = Lake()
        publish(lake)
        name = next(iter(approved()))
        del lake.files[f"{DOCUMENTS}/{name}"]
        start = len(lake.log)
        publish(lake)
        self.assertEqual(lake.log[start:], [("mkdirs", DOCUMENTS), ("put", f"{DOCUMENTS}/{name}")])

    def test_different_content_stops_the_run_before_anything_is_written(self):
        lake = Lake()
        lake.directories.add(DOCUMENTS)
        changed, untouched = list(approved())[:2]
        lake.files[f"{DOCUMENTS}/{changed}"] = approved()[changed].replace("Approved", "Draft")
        with self.assertRaisesRegex(RuntimeError, f"different content for {changed}. Approved documents are never"):
            publish(lake)
        self.assertEqual(lake.log, [])
        self.assertNotIn(f"{DOCUMENTS}/{untouched}", lake.files)

    def test_a_readback_that_differs_fails_the_run(self):
        class Lossy(Lake):
            def put(self, path, content, overwrite):
                return super().put(path, content.replace("£", "?"), overwrite)

        with self.assertRaisesRegex(RuntimeError, "does not read back as its approved text"):
            publish(Lossy())

    def test_text_altered_after_review_is_refused(self):
        cells = _support.cells

        def altered(name):
            return [cell.replace("Approved by: Publishing director", "Approved by: Nobody") for cell in cells(name)]

        lake = Lake()
        with mock.patch.object(_support, "cells", altered), self.assertRaisesRegex(ValueError, "reviewed SHA-256"):
            publish(lake)
        self.assertEqual(lake.log, [])

    def test_the_generator_refuses_text_the_embedded_string_or_notebook_format_would_change(self):
        spec = importlib.util.spec_from_file_location("embed_knowledge", GENERATOR)
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        name = "bks-pol-001-reprint-and-stock-policy-v1.md"
        text = (SOURCES / name).read_text(encoding="utf-8")
        self.assertEqual(generator.problems(name, text.encode()), [])
        for case, data, problem in (
            (name, text.replace("Owner:", "Owner\\:"), "a backslash"),
            (name, text.replace("\n", "\r\n"), "a carriage return"),
            (name, text + "# CELL ********************\n", "Fabric notebook delimiter"),
            (name, text.replace("Version 1.0", "Version 2.0"), "does not match BKS-POL-001 Version 2"),
            ("reprint-policy.md", text, "the name is not"),
        ):
            with self.subTest(problem=problem):
                self.assertTrue(any(problem in found for found in generator.problems(case, data.encode())))

    def test_nothing_is_published_outside_a_dev_or_test_lakehouse(self):
        for parameters, context, message in (
            ({}, {"workspace_name": "books-prod"}, "restricted to -dev/-test workspaces"),
            ({"allow_other_workspaces": "true"}, {"workspace_name": "books-prod"}, "must be a Boolean"),
            ({}, {"lakehouse_workspace": OTHER_ID}, "outside the current workspace"),
        ):
            lake = Lake()
            with self.subTest(parameters=parameters, context=context), self.assertRaisesRegex(ValueError, message):
                publish(lake, parameters, **context)
            self.assertEqual(lake.log, [])
        lake = Lake()
        publish(lake, {"allow_other_workspaces": True}, workspace_name="books-prod")
        self.assertEqual(len(lake.files), len(approved()))


if __name__ == "__main__":
    unittest.main()
