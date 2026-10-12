# Vendored files for the GitHub Actions lab

| File | What it is | Source |
|---|---|---|
| `js-yaml.min.js` | YAML parser (MIT) | js-yaml 4.3.2 from npm |
| `wasm_exec.js` | Go's WebAssembly loader (BSD) | `$(go env GOROOT)/lib/wasm/wasm_exec.js` from Go 1.26.1 |
| `actionlint.wasm.gz` | actionlint 1.7.12 (MIT) compiled to WebAssembly and gzipped | built from `actionlint-wasm-main.go` (see below) |
| `actions-meta.json` | the inputs and runtime of every action the lab uses, read from each action's own `action.yml` on GitHub | `node ../fetch-actions.js` |

Rebuild the checker:

```bash
mkdir lint && cd lint
cp ../actionlint-wasm-main.go main.go && cp ../actionlint-wasm-go.mod go.mod && cp ../actionlint-wasm-go.sum go.sum
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o actionlint.wasm .
gzip -9 -n -c actionlint.wasm > ../actionlint.wasm.gz
```

`tests/actions.test.js` checks that this build gives the same answers as the real `actionlint` binary of the same version.
