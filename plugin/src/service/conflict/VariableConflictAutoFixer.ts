import { TFile, Vault } from "obsidian";
import { FormConfig } from "src/model/FormConfig";
import { FormActionType } from "src/model/enums/FormActionType";
import { AIFormAction } from "src/model/action/AIFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { SuggestModalFormAction } from "src/model/action/SuggestModalFormAction";
import { GenerateFormAction } from "src/model/action/OpenFormAction";
import { IFormAction } from "src/model/action/IFormAction";
import { ConflictInfo, VariableInfo, VariableSource } from "src/types/variable";
import { VariableRegistry } from "src/service/variable/VariableRegistry";
import { VariableNameValidator } from "src/utils/VariableNameValidator";

export class VariableConflictAutoFixer {
  /**
   * 一键修复：对单个表单内的变量冲突项，自动为“冲突中的非首项”生成不重复的新名称。
   * 注意：为避免错误替换引用文本，这里仅修改变量的“定义处”（字段 label / 动作变量名）。
   */
  static async fixFileConflicts(vault: Vault, filePath: string, conflicts: ConflictInfo[]): Promise<boolean> {
    const abstract = vault.getAbstractFileByPath(filePath);
    if (!(abstract instanceof TFile)) {
      return false;
    }

    const raw = await vault.read(abstract);
    const parsed = JSON.parse(raw);
    const config = Object.assign(new FormConfig(parsed.id), parsed) as FormConfig;

    const allVariables = VariableRegistry.collectAllVariables(config, { includeSystemReserved: false });
    const usedNames = new Set(allVariables.map((v) => (v.name ?? "").trim()).filter(Boolean));

    let changed = false;

    for (const conflict of conflicts) {
      const items = (conflict.items || []).filter((item) => {
        const name = (item.name ?? "").trim();
        return !!name;
      });

      if (items.length <= 1) {
        continue;
      }

      // 保留第一项名称不变，为后续项生成新名称
      const baseName = (items[0].name ?? "").trim();
      if (!baseName) {
        continue;
      }

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const nextName = this.generateUniqueName(baseName, usedNames);
        const updated = this.applyRenameToDefinition(config, item, nextName);
        if (updated) {
          usedNames.add(nextName);
          changed = true;
        }
      }
    }

    if (!changed) {
      return false;
    }

    // 写回文件（保持 JSON 可读性）
    await vault.modify(abstract, JSON.stringify(config, null, 2));
    return true;
  }

  private static generateUniqueName(baseName: string, usedNames: Set<string>): string {
    let candidate = VariableNameValidator.suggestAlternativeName(baseName, usedNames);
    if (!usedNames.has(candidate)) {
      return candidate;
    }

    // 兜底：继续生成直到不冲突
    let counter = 2;
    while (usedNames.has(`${candidate}_${counter}`)) {
      counter++;
    }
    return `${candidate}_${counter}`;
  }

  private static applyRenameToDefinition(config: FormConfig, variable: VariableInfo, newName: string): boolean {
    const trimmed = newName.trim();
    if (!trimmed) {
      return false;
    }

    // 1) 顶层字段
    if (variable.source === VariableSource.FORM_FIELD && variable.sourceId) {
      const field = (config.fields || []).find((f) => f.id === variable.sourceId);
      if (field) {
        field.label = trimmed;
        return true;
      }
    }

    const actions = this.flattenActions(config);

    // 2) 生成表单动作中的子字段
    if (variable.source === VariableSource.FORM_FIELD && variable.sourceId) {
      for (const action of actions) {
        if (action.type !== FormActionType.GENERATE_FORM) {
          continue;
        }
        const generated = action as GenerateFormAction;
        const childField = (generated.fields || []).find((f) => f.id === variable.sourceId);
        if (childField) {
          childField.label = trimmed;
          return true;
        }
      }
    }

    // 3) SuggestModal 动作字段名
    if (variable.source === VariableSource.SUGGEST_MODAL && variable.sourceId) {
      for (const action of actions) {
        if (action.type !== FormActionType.SUGGEST_MODAL) {
          continue;
        }
        if (action.id !== variable.sourceId) {
          continue;
        }
        const suggest = action as SuggestModalFormAction;
        suggest.fieldName = trimmed;
        return true;
      }
    }

    // 4) AI 输出变量名
    if (variable.source === VariableSource.AI_OUTPUT && variable.sourceId) {
      for (const action of actions) {
        if (action.type !== FormActionType.AI) {
          continue;
        }
        if (action.id !== variable.sourceId) {
          continue;
        }
        const ai = action as AIFormAction;
        ai.outputVariableName = trimmed;
        return true;
      }
    }

    // 5) Loop 动作变量名（item/index/total）
    if (variable.source === VariableSource.LOOP_VAR && variable.sourceId) {
      for (const action of actions) {
        if (action.type !== FormActionType.LOOP) {
          continue;
        }
        if (action.id !== variable.sourceId) {
          continue;
        }
        const loop = action as LoopFormAction;
        const oldName = (variable.name ?? "").trim();
        let updated = false;

        if ((loop.itemVariableName ?? "").trim() === oldName) {
          loop.itemVariableName = trimmed;
          updated = true;
        }
        if ((loop.indexVariableName ?? "").trim() === oldName) {
          loop.indexVariableName = trimmed;
          updated = true;
        }
        if ((loop.totalVariableName ?? "").trim() === oldName) {
          loop.totalVariableName = trimmed;
          updated = true;
        }

        return updated;
      }
    }

    return false;
  }

  private static flattenActions(formConfig: FormConfig): IFormAction[] {
    const result: IFormAction[] = [];
    const visitedGroupIds = new Set<string>();

    const traverse = (actions: IFormAction[] | undefined) => {
      if (!actions) {
        return;
      }
      actions.forEach((action) => {
        result.push(action);
        if (action.type === FormActionType.LOOP) {
          const loopAction = action as LoopFormAction;
          if (!loopAction.actionGroupId) {
            return;
          }
          if (visitedGroupIds.has(loopAction.actionGroupId)) {
            return;
          }
          visitedGroupIds.add(loopAction.actionGroupId);
          const group = (formConfig.actionGroups || []).find((g) => g.id === loopAction.actionGroupId);
          if (group) {
            traverse(group.actions);
          }
        }
      });
    };

    traverse(formConfig.actions || []);
    return result;
  }
}
