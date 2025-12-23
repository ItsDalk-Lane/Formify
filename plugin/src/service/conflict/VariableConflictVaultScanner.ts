import { TFile, Vault } from "obsidian";
import { FormConfig } from "src/model/FormConfig";
import { VariableConflictDetector } from "src/service/variable/VariableConflictDetector";
import { ConflictInfo } from "src/types/variable";
import { DetectedConflict } from "./ConflictTypes";

export type VariableConflictScanResult = {
  conflicts: DetectedConflict[];
  /** 参与扫描的表单数 */
  totalForms: number;
  /** 原始冲突信息，按文件路径分组（用于一键修复） */
  conflictsByFile: Map<string, ConflictInfo[]>;
};

export class VariableConflictVaultScanner {
  static async scan(vault: Vault): Promise<VariableConflictScanResult> {
    const formFiles = vault.getFiles().filter((file) => file.extension === "cform");
    const conflicts: DetectedConflict[] = [];
    const conflictsByFile = new Map<string, ConflictInfo[]>();

    for (const file of formFiles) {
      const conflictInfos = await this.scanSingleFile(vault, file);
      if (conflictInfos.length === 0) {
        continue;
      }

      conflictsByFile.set(file.path, conflictInfos);

      for (const conflict of conflictInfos) {
        const variableName = (conflict.variableName ?? "").trim();
        if (!variableName) {
          continue;
        }

        conflicts.push({
          kind: "variable",
          name: variableName,
          conflictType: String(conflict.conflictType ?? "UNKNOWN"),
          items: (conflict.items || []).map((item) => ({
            filePath: file.path,
            fileName: file.basename,
            detailPath: item.location?.path,
            source: String(item.source ?? "")
          }))
        });
      }
    }

    return {
      conflicts,
      totalForms: formFiles.length,
      conflictsByFile
    };
  }

  private static async scanSingleFile(vault: Vault, file: TFile): Promise<ConflictInfo[]> {
    try {
      const raw = await vault.read(file);
      const parsed = JSON.parse(raw);
      const config = Object.assign(new FormConfig(parsed.id), parsed);
      return VariableConflictDetector.detectConflictsFromConfig(config);
    } catch {
      return [];
    }
  }
}
