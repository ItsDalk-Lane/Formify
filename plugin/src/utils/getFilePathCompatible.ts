import { FileBaseFormAction } from "../model/action/FileBaseFormAction";
import { normalizePath } from "obsidian";
import { Strings } from "./Strings";

export function getFilePathCompatible(action: FileBaseFormAction) {
    if (Strings.isNotEmpty(action.filePath)) {
        return action.filePath;
    }

    // 检查 targetFolder 和 fileName 是否为 undefined 或 null
    const folder = action.targetFolder ?? "";
    const fileName = action.fileName ?? "";

    const path =
        normalizePath(folder) +
        "/" +
        normalizePath(fileName)

    if (Strings.isBlank(folder) && Strings.isBlank(fileName)) {
        return "";
    }
    return normalizePath(path + ".md");
}
