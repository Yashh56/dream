import { describe, expect, test } from "vitest";
import {
  completeFolder,
  folderToList,
  matchFolders,
  splitFolderInput,
} from "./folder-path";

const entry = (name: string) => ({
  hidden: name.startsWith("."),
  name,
  path: `/home/me/${name}`,
});

describe("splitFolderInput", () => {
  test("splits at the last separator", () => {
    expect(splitFolderInput("~/dev/dre", "/")).toEqual({
      parent: "~/dev/",
      prefix: "dre",
    });
    expect(splitFolderInput("/", "/")).toEqual({ parent: "/", prefix: "" });
    expect(splitFolderInput("dev", "/")).toEqual({ parent: "", prefix: "dev" });
  });

  test("a backslash separates only on a Windows host", () => {
    expect(splitFolderInput("C:\\Users\\me", "\\")).toEqual({
      parent: "C:\\Users\\",
      prefix: "me",
    });
    expect(splitFolderInput("odd\\name", "/")).toEqual({
      parent: "",
      prefix: "odd\\name",
    });
  });
});

test("nothing typed lists home", () => {
  expect(folderToList("")).toBe("~/");
  expect(folderToList("/srv/")).toBe("/srv/");
});

test("folders match their start, ignoring case; hidden ones on a dot", () => {
  const folders = ["Dev", "dream", ".config", "docs"].map(entry);
  expect(matchFolders(folders, "d").map((item) => item.name)).toEqual([
    "Dev",
    "dream",
    "docs",
  ]);
  expect(matchFolders(folders, "DR").map((item) => item.name)).toEqual([
    "dream",
  ]);
  expect(matchFolders(folders, "").map((item) => item.name)).toEqual([
    "Dev",
    "dream",
    "docs",
  ]);
  expect(matchFolders(folders, ".").map((item) => item.name)).toEqual([
    ".config",
  ]);
});

test("completing a folder enters it", () => {
  expect(completeFolder("~/dev/", "dream", "/")).toBe("~/dev/dream/");
  expect(completeFolder("", "dev", "/")).toBe("~/dev/");
  expect(completeFolder("C:\\", "Users", "\\")).toBe("C:\\Users\\");
});
