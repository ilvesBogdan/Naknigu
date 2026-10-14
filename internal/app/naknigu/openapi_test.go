package naknigu

// Сверка api/openapi.yaml с кодом сервера: маршруты и коды ошибок. Клиентов с тем же файлом сверяет web/shared/contract.test.ts.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ilvesBogdan/naknigu/internal/pkg/pagefetch"
	"github.com/ilvesBogdan/naknigu/internal/pkg/relay"
)

const specPath = "../../../api/openapi.yaml"

// yamlLine — одна значимая строка блочного YAML: путь ключей от корня
// и значение. У элемента списка («- значение») последний ключ пути — «-».
type yamlLine struct {
	path  []string
	value string
}

// scanYAML разбирает блочный YAML ровно настолько, насколько нужно сверке:
// вложенность определяется отступами, значения в фигурных скобках
// (`{ type: string }`) остаются строками. Стандартная библиотека Go YAML
// не читает, а внешних зависимостей у сервера нет.
func scanYAML(text string) []yamlLine {
	type level struct {
		indent int
		key    string
	}
	var stack []level
	var lines []yamlLine
	block := -1 // отступ ключа, после которого идёт многострочный текст (>- или |)
	for _, raw := range strings.Split(text, "\n") {
		line := stripComment(raw)
		content := strings.TrimSpace(line)
		if content == "" || content == "---" {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		if block >= 0 && indent > block {
			continue // строка многострочного текста: двоеточия в ней — не ключи
		}
		block = -1
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		path := make([]string, 0, len(stack)+1)
		for _, l := range stack {
			path = append(path, l.key)
		}

		if item, ok := strings.CutPrefix(content, "- "); ok || content == "-" {
			lines = append(lines, yamlLine{path: append(path, "-"), value: strings.TrimSpace(item)})
			stack = append(stack, level{indent, "-"})
			continue
		}
		key, value, found := strings.Cut(content, ":")
		if !found {
			continue
		}
		key = strings.Trim(strings.TrimSpace(key), `"'`)
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, ">") || strings.HasPrefix(value, "|") {
			block = indent
		}
		lines = append(lines, yamlLine{path: append(path, key), value: value})
		stack = append(stack, level{indent, key})
	}
	return lines
}

// stripComment убирает комментарий «# …», если решётка стоит не в кавычках.
func stripComment(line string) string {
	quote := rune(0)
	for i, c := range line {
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '#' && (i == 0 || line[i-1] == ' '):
			return line[:i]
		}
	}
	return line
}

var httpMethods = []string{"get", "post", "put", "patch", "delete", "head", "options"}

// specOperations возвращает операции из раздела paths: "GET /api/health".
// Ключей доступа у API нет, поэтому раздела security в описании быть не должно.
func specOperations(t *testing.T, lines []yamlLine) map[string]bool {
	t.Helper()
	ops := map[string]bool{}
	for _, l := range lines {
		if len(l.path) == 3 && l.path[0] == "paths" && slices.Contains(httpMethods, l.path[2]) {
			ops[strings.ToUpper(l.path[2])+" "+l.path[1]] = true
		}
		if slices.Contains(l.path, "security") || slices.Contains(l.path, "securitySchemes") {
			t.Errorf("в api/openapi.yaml есть %s, а ключей доступа у сервера нет", strings.Join(l.path, "."))
		}
	}
	if len(ops) == 0 {
		t.Fatal("в api/openapi.yaml не нашлось ни одной операции — разбор сломался?")
	}
	return ops
}

func readSpec(t *testing.T) []yamlLine {
	t.Helper()
	text, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatal(err)
	}
	return scanYAML(string(text))
}

func TestOpenAPIMatchesRoutes(t *testing.T) {
	spec := specOperations(t, readSpec(t))

	code := map[string]bool{}
	for _, r := range routes(Config{}, quiet, relay.NewHub(), pagefetch.New()) {
		name := r.Method + " " + r.Path
		if code[name] {
			t.Errorf("маршрут %s объявлен дважды", name)
		}
		code[name] = true
	}

	for name := range code {
		if !spec[name] {
			t.Errorf("сервер обслуживает %s, но в api/openapi.yaml этого нет", name)
		}
	}
	for name := range spec {
		if !code[name] {
			t.Errorf("в api/openapi.yaml описан %s, но сервер его не обслуживает", name)
		}
	}
}

func TestOpenAPIErrorCodesMatchCode(t *testing.T) {
	var described []string
	for _, l := range readSpec(t) {
		if slices.Equal(l.path, []string{"components", "schemas", "ErrorCode", "enum", "-"}) {
			described = append(described, l.value)
		}
	}
	if len(described) == 0 {
		t.Fatal("в api/openapi.yaml нет списка components.schemas.ErrorCode.enum")
	}

	used := errorCodesInCode(t, "../..")
	for code := range used {
		if !slices.Contains(described, code) {
			t.Errorf("сервер отвечает кодом ошибки %q, а в api/openapi.yaml его нет", code)
		}
	}
	for _, code := range described {
		if !used[code] {
			t.Errorf("в api/openapi.yaml описан код ошибки %q, но сервер им не отвечает", code)
		}
	}
}

// errorCodesInCode находит в исходниках сервера (без тестов) все коды
// ошибок: аргументы httpx.WriteError, поле Error у httpx.ErrorBody и коды
// в таблице ошибок скачивания pagefetch.failures.
func errorCodesInCode(t *testing.T, root string) map[string]bool {
	t.Helper()
	codes := map[string]bool{}
	literal := func(e ast.Expr) {
		if lit, ok := e.(*ast.BasicLit); ok && lit.Kind == token.STRING {
			if s, err := strconv.Unquote(lit.Value); err == nil {
				codes[s] = true
			}
		}
	}
	name := func(e ast.Expr) string {
		switch e := e.(type) {
		case *ast.Ident:
			return e.Name
		case *ast.SelectorExpr:
			return e.Sel.Name
		}
		return ""
	}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.CallExpr:
				if name(n.Fun) == "WriteError" && len(n.Args) == 3 {
					literal(n.Args[2])
				}
			case *ast.CompositeLit:
				if name(n.Type) == "ErrorBody" {
					for _, el := range n.Elts {
						if kv, ok := el.(*ast.KeyValueExpr); ok && name(kv.Key) == "Error" {
							literal(kv.Value)
						}
					}
				}
				// []failure{{ErrBadURL, http.StatusBadRequest, "bad_url", …}, …}: код — третье поле.
				if arr, ok := n.Type.(*ast.ArrayType); ok && name(arr.Elt) == "failure" {
					for _, el := range n.Elts {
						if row, ok := el.(*ast.CompositeLit); ok && len(row.Elts) > 2 {
							literal(row.Elts[2])
						}
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) == 0 {
		t.Fatal("в исходниках сервера не нашлось ни одного кода ошибки — поиск сломался?")
	}
	return codes
}

func TestScanYAML(t *testing.T) {
	lines := scanYAML(`paths:
  /a: # комментарий
    get:
      summary: "a # не комментарий"
      description: >-
        Текст: с двоеточием
        на двух строках.
      security:
        - key: []
components:
  list:
    - one
    - two
`)
	var got []string
	for _, l := range lines {
		got = append(got, strings.Join(l.path, ".")+"="+l.value)
	}
	want := []string{
		"paths=", "paths./a=", "paths./a.get=", `paths./a.get.summary="a # не комментарий"`, "paths./a.get.description=>-",
		"paths./a.get.security=", "paths./a.get.security.-=key: []",
		"components=", "components.list=", "components.list.-=one", "components.list.-=two",
	}
	if !slices.Equal(got, want) {
		t.Errorf("разбор:\n%s\nожидался:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
