# dsh-intellisense

Shared profiles, namespace-based tool calls, and on-demand TypeScript signatures for DeepSeek Harness.

- **Intellisense PTC**: run isolated TypeScript/JavaScript with the plugin-owned `tools_run_code` and call tools through namespaces.
- **Intellisense**: call namespace tools directly through native DSML.

Requires Node.js >=24. The runtime uses Node.js native permissions (`--permission`); Python and libseccomp are not required. Node.js 24 permissions do not restrict network access.

```sh
npm ci
./run.sh
```

Documentation: [English](docs/en/README.md) | [简体中文](docs/zh/README.md)
