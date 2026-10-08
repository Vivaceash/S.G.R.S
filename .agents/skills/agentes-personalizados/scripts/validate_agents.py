#!/usr/bin/env python3
"""Validate agent files and skill paths; runtime compatibility needs a smoke test."""

import argparse
from pathlib import Path
import re
import sys

import yaml


class UniqueLoader(yaml.SafeLoader):
    """Reject duplicate mapping keys instead of silently dropping values."""


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError(f"duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping
)


def frontmatter(path):
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", path.read_text(), re.S)
    if not match:
        raise ValueError("missing YAML frontmatter")
    data = yaml.load(match.group(1), Loader=UniqueLoader)
    if not isinstance(data, dict):
        raise ValueError("frontmatter must be a mapping")
    return data


def validate(path, root, tools):
    data = frontmatter(path)
    for field in ("name", "description"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError(f"{field} must be a nonempty string")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", data["name"]):
        raise ValueError("name must be kebab-case")
    for field in ("mainAgent", "subagent"):
        if field in data and type(data[field]) is not bool:
            raise ValueError(f"{field} must be a boolean")
    if not (data.get("mainAgent", True) or data.get("subagent", True)):
        raise ValueError("agent is neither selectable nor delegable")
    enums = {
        "model": {"inherit", "flash", "pro"},
        "commandExecutionPolicy": {"off", "sandbox", "auto", "eager"},
        "permissionMode": {"acceptEdits", "bypassPermissions"},
    }
    for field, choices in enums.items():
        if field in data and (
            not isinstance(data[field], str) or data[field] not in choices
        ):
            raise ValueError(f"unsupported {field}: {data[field]!r}; check runtime schema")
    for field in ("tools", "skills", "plugins"):
        entries = data.get(field, [])
        if not isinstance(entries, list) or any(
            not isinstance(item, str) or not item.strip() for item in entries
        ):
            raise ValueError(f"{field} must be a list of nonempty strings")
        if len(entries) != len(set(entries)):
            raise ValueError(f"duplicate {field} entries")
    if tools is not None:
        missing = set(data.get("tools", [])) - tools
        if missing:
            raise ValueError(f"tools absent from supplied catalog: {sorted(missing)}")
    for entry in data.get("skills", []):
        skill_dir = Path(entry).expanduser()
        if not skill_dir.is_absolute():
            skill_dir = root / skill_dir
        skill = frontmatter(skill_dir / "SKILL.md")
        if not all(isinstance(skill.get(key), str) and skill[key].strip()
                   for key in ("name", "description")):
            raise ValueError(f"invalid skill metadata: {skill_dir}")
    return data["name"], len(data.get("skills", []))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--customization-root", required=True, type=Path)
    parser.add_argument("--tools-file", type=Path,
                        help="actual session tool names, one per line")
    args = parser.parse_args()
    tools = None
    if args.tools_file:
        tools = {line.strip() for line in args.tools_file.read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith("#")}
    failures = 0
    count = 0
    names = {}
    for source in args.paths:
        files = (sorted(source.glob("*.md")) + sorted(source.glob("*/agent.md"))
                 if source.is_dir() else [source])
        if not files:
            print(f"FAIL {source}: no agent definitions")
            failures += 1
        for path in files:
            count += 1
            try:
                name, skills = validate(path, args.customization_root.resolve(), tools)
                scope = source if source.is_dir() else path.parent
                key = (scope.resolve(), name)
                if key in names:
                    raise ValueError(f"duplicate agent name, also in {names[key]}")
                names[key] = path
                print(f"PASS {path}: {skills} skill paths resolved")
            except (OSError, ValueError, TypeError, yaml.YAMLError) as exc:
                print(f"FAIL {path}: {exc}")
                failures += 1
    print(f"Checked {count} agents; {failures} failures.")
    if tools is None:
        print("Tool compatibility NOT CHECKED: no runtime catalog supplied.")
    print("Runtime discovery, skill loading and invocation NOT CHECKED.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
