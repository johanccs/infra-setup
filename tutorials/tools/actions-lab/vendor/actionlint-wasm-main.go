//go:build js && wasm

// A tiny wrapper that exposes actionlint to the page: lintWorkflow(source) returns a JSON string.
package main

import (
	"encoding/json"
	"io"
	"syscall/js"

	"github.com/rhysd/actionlint"
)

type problem struct {
	Message string `json:"message"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Kind    string `json:"kind"`
}

func lint(_ js.Value, args []js.Value) any {
	linter, err := actionlint.NewLinter(io.Discard, &actionlint.LinterOptions{})
	if err != nil {
		return `{"fatal":"` + err.Error() + `"}`
	}
	errs, err := linter.Lint("workflow.yml", []byte(args[0].String()), nil)
	if err != nil {
		return `{"fatal":"` + err.Error() + `"}`
	}
	out := make([]problem, 0, len(errs))
	for _, e := range errs {
		out = append(out, problem{e.Message, e.Line, e.Column, e.Kind})
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func main() {
	js.Global().Set("lintWorkflow", js.FuncOf(lint))
	js.Global().Set("lintReady", js.ValueOf(true))
	select {}
}
