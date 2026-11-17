#!/usr/bin/env python3
"""Embed the approved documents in scenario/knowledge/ into PublishBooksKnowledge, byte for byte.

Run it after adding a document or a revision; --check only reports whether the notebook is current. Each
document is embedded with its SHA-256 as a plain triple-quoted string, which holds it unchanged only without
backslashes, triple quotes, carriage returns or tabs, so those are refused, together with trailing spaces,
lines that look like Fabric notebook delimiters and a missing final newline. A document's file name must
match its Document ID and major version, such as bks-pol-001-reprint-and-stock-policy-v1.md for
BKS-POL-001 Version 1.0.
"""

import argparse
import hashlib
from pathlib import Path
import re

NOTEBOOK = Path("workspace/PublishBooksKnowledge.Notebook/notebook-content.py")
SOURCES = Path("scenario/knowledge")
BEGIN, END = "# BEGIN APPROVED DOCUMENTS\n", "# END APPROVED DOCUMENTS\n"
LIMIT = 64 * 1024
NAME = re.compile(r"(?P<id>[a-z]{3}-[a-z]{3}-\d{3})(?:-[a-z0-9]+)+-v(?P<major>\d+)\.md")
HEADER = re.compile(r"(?m)^Document ID: (?P<id>[A-Z]{3}-[A-Z]{3}-\d{3}) · Version (?P<major>\d+)\.\d+ · Approved"
                    r" · Effective \d{1,2} [A-Z][a-z]+ \d{4} · Review by \d{1,2} [A-Z][a-z]+ \d{4}$")
# Fabric splits a notebook-content.py file on these comment lines, even inside a string.
DELIMITER = re.compile(r"(?mi)^# (?:META|CELL|PARAMETERS|MARKDOWN)")


def problems(name, data):
    match = NAME.fullmatch(name)
    if not match:
        return ["the name is not <document id>-<title>-v<major version>.md in lowercase"]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return ["it is not UTF-8"]
    found = []
    if len(data) > LIMIT:
        found.append(f"it is larger than {LIMIT} bytes")
    if not text.startswith("# ") or not text.endswith("\n") or text.endswith("\n\n"):
        found.append("it must start with a '# ' title and end with exactly one newline")
    for symbol, label in (("\\", "a backslash"), ('"""', "triple quotes"), ("\r", "a carriage return"),
                          ("\t", "a tab")):
        if symbol in text:
            found.append(f"it contains {label}")
    if re.search(r"(?m) $", text):
        found.append("a line ends with a space")
    if DELIMITER.search(text):
        found.append("a line starts like a Fabric notebook delimiter (# META, # CELL, # PARAMETERS, # MARKDOWN)")
    header = HEADER.search(text)
    if not header:
        found.append("it has no 'Document ID: <ID> · Version <n.n> · Approved · Effective <date> · Review by <date>' "
                     "line")
    elif (header["id"].lower(), header["major"]) != (match["id"], match["major"]):
        found.append(f"its name does not match {header['id']} Version {header['major']}")
    return found


def documents(root):
    """Every approved document by file name, in name order: all files in scenario/knowledge/ except README.md."""
    found, errors = {}, []
    for path in sorted((root / SOURCES).iterdir()):
        if path.name == "README.md":
            continue
        if path.is_symlink() or not path.is_file():
            errors.append(f"{path.name}: not a regular file")
            continue
        data = path.read_bytes()
        errors += [f"{path.name}: {problem}" for problem in problems(path.name, data)]
        found[path.name] = data
    if errors:
        raise ValueError("; ".join(errors))
    if not found:
        raise ValueError(f"{SOURCES} holds no approved documents.")
    return {name: data.decode("utf-8") for name, data in found.items()}


def render(found):
    """The notebook block: each file name with the SHA-256 of its UTF-8 bytes and its exact text."""
    lines = [BEGIN, "DOCUMENTS = {\n"]
    for name, text in found.items():
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        lines.append(f'    "{name}": ("{digest}", """\\\n{text}"""),\n')
    return "".join(lines + ["}\n", END])


def embedded(source):
    """The start and end offsets of the generated block in the notebook source."""
    if source.count(BEGIN) != 1 or source.count(END) != 1 or source.index(BEGIN) > source.index(END):
        raise ValueError(f"{NOTEBOOK} must hold exactly one {BEGIN.strip()} ... {END.strip()} block.")
    return source.index(BEGIN), source.index(END) + len(END)


def main(argv=None, root=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only report whether the notebook is current")
    args = parser.parse_args(argv)
    root = Path(root) if root else Path(__file__).resolve().parents[4]
    target = root / NOTEBOOK
    try:
        if target.is_symlink():
            raise ValueError(f"Refusing to update a symlinked {NOTEBOOK}.")
        source = target.read_text(encoding="utf-8")
        start, end = embedded(source)
        found = documents(root)
        updated = source[:start] + render(found) + source[end:]
    except (OSError, ValueError) as error:
        parser.exit(1, f"Embedding the approved documents failed: {error}\n")
    if updated == source:
        print(f"{NOTEBOOK} already embeds the {len(found)} approved documents.")
        return
    if args.check:
        parser.exit(1, f"{NOTEBOOK} is out of date with {SOURCES}/; run {Path(__file__).name} without --check.\n")
    target.write_text(updated, encoding="utf-8")
    print(f"Embedded {len(found)} approved documents in {NOTEBOOK}. Run the Fabric notebook tests, then review "
          "and commit both.")


if __name__ == "__main__":
    main()
