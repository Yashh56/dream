import { expect, test } from "vitest";
import { resolveProjectFilePath } from "./project-file-path";

test("relative paths are kept, without a leading ./", () => {
  expect(resolveProjectFilePath("/work/app", "src/a.ts")).toBe("src/a.ts");
  expect(resolveProjectFilePath("/work/app", "./src/a.ts")).toBe("src/a.ts");
});

test("absolute paths inside the project become relative", () => {
  expect(resolveProjectFilePath("/work/app/", "/work/app/src/a.ts")).toBe(
    "src/a.ts",
  );
  expect(
    resolveProjectFilePath("E:\\dev\\app", "e:\\dev\\app\\src\\a.ts"),
  ).toBe("src/a.ts");
});

test("POSIX paths compare case-sensitively", () => {
  expect(resolveProjectFilePath("/work/app", "/work/App/a.ts")).toBeNull();
});

test("paths outside the project, or the folder itself, resolve to nothing", () => {
  expect(resolveProjectFilePath("/work/app", "/work/other/a.ts")).toBeNull();
  expect(resolveProjectFilePath("/work/app", "/work/app-two/a.ts")).toBeNull();
  expect(resolveProjectFilePath("/work/app", "/work/app")).toBeNull();
  expect(resolveProjectFilePath("/work/app", "../other/a.ts")).toBeNull();
  expect(resolveProjectFilePath("/work/app", "src/../../a.ts")).toBeNull();
  expect(resolveProjectFilePath("/work/app", "  ")).toBeNull();
});
