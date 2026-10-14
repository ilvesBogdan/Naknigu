// Сверка клиентов с api/openapi.yaml: клиенты обращаются только к описанным
// адресам и умеют показать каждый код ошибки сервера. Сервер с тем же
// файлом сверяет internal/app/naknigu/openapi_test.go.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { ENDPOINTS } from "./api";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const web = join(repo, "web");

interface Spec {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: { ErrorCode: { enum: string[] } } };
}

const spec = parse(readFileSync(join(repo, "api/openapi.yaml"), "utf8")) as Spec;

/** Операции описания: "GET /api/fetch". */
const operations = new Set<string>();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const method of Object.keys(methods)) {
    operations.add(method.toUpperCase() + " " + path);
  }
}

describe("клиенты и api/openapi.yaml", () => {
  test.each(Object.entries(ENDPOINTS))("%s описан в api/openapi.yaml", (_, endpoint) => {
    const name = endpoint.method + " " + endpoint.path;
    expect(operations.has(name), `${name} нет в api/openapi.yaml`).toBe(true);
  });

  test("к серверу обращаются только через shared/api.ts", () => {
    // Иначе адрес мог бы обойти ENDPOINTS, и сверка выше его не увидела бы.
    const offenders = sources().filter((file) => !file.endsWith("shared/api.ts") && readFileSync(file, "utf8").includes("/api/"));
    expect(offenders.map((file) => relative(repo, file))).toEqual([]);
  });

  test("каждый код ошибки сервера переведён в словарях клиентов", () => {
    const codes = spec.components.schemas.ErrorCode.enum;
    expect(codes.length).toBeGreaterThan(0);
    const dictionaries = ["phone/src/locales/ru.json", "phone/src/locales/en.json", "book/locales/ru.json", "book/locales/en.json"];
    for (const file of dictionaries) {
      const dictionary = JSON.parse(readFileSync(join(web, file), "utf8")) as Record<string, string>;
      const missing = codes.filter((code) => !("errors." + code in dictionary));
      expect(missing, `в ${file} нет перевода для кодов`).toEqual([]);
    }
  });
});

/** Исходники клиентов, которые попадают в сборку (без тестов). */
function sources(): string[] {
  const roots = ["book/src", "book/static", "phone/src", "phone/public", "phone/index.html", "shared", "site/src"];
  const files: string[] = [];
  const walk = (path: string) => {
    if (statSync(path).isDirectory()) {
      readdirSync(path).forEach((name) => walk(join(path, name)));
    } else if (/\.(ts|js|svelte|html)$/.test(path) && !/\.test\.ts$/.test(path)) {
      files.push(path);
    }
  };
  roots.forEach((root) => walk(join(web, root)));
  expect(files.length).toBeGreaterThan(10);
  return files;
}
