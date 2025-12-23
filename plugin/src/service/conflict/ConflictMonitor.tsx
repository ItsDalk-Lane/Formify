import { App, EventRef, TAbstractFile, Vault } from "obsidian";
import { Toast } from "../../component/toast/Toast";
import { ToastManager } from "../../component/toast/ToastManager";
import ConflictToastContent from "../../component/toast/conflict/ConflictToastContent";
import { DebugLogger } from "../../utils/DebugLogger";
import { CommandIdConflictDetector } from "../variable/CommandIdConflictDetector";
import { VariableConflictVaultScanner } from "./VariableConflictVaultScanner";
import { VariableConflictAutoFixer } from "./VariableConflictAutoFixer";
import { DetectedConflict } from "./ConflictTypes";

type ScanResult = {
  conflicts: DetectedConflict[];
  commandIdConflicts: Awaited<ReturnType<typeof CommandIdConflictDetector.detectConflicts>>["conflicts"];
  variableConflictsByFile: Awaited<ReturnType<typeof VariableConflictVaultScanner.scan>>["conflictsByFile"];
};

export class ConflictMonitor {
  private toast: Toast | null = null;
  private lastSignature: string | null = null;
  private scanTimer: number | null = null;
  private disposed = false;
  private refs: EventRef[] = [];

  constructor(private app: App) {}

  start() {
    // 初次扫描
    this.scheduleScan(200);

    // 监听 .cform 文件变化，做防抖扫描
    const vault = this.app.vault;
    const onAny = (file: TAbstractFile) => {
      // 只关心 .cform；TFolder 没有 extension
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (file as any)?.extension;
      if (ext !== "cform") {
        return;
      }
      this.scheduleScan(500);
    };

    this.refs.push(vault.on("modify", onAny));
    this.refs.push(vault.on("create", onAny));
    this.refs.push(vault.on("delete", onAny));
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();

    const vault = this.app.vault;
    for (const ref of this.refs) {
      try {
        vault.offref(ref);
      } catch {
        // ignore
      }
    }
    this.refs = [];

    this.removeToast();
  }

  private scheduleScan(delayMs: number) {
    if (this.disposed) {
      return;
    }
    this.clearTimer();
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      this.scanAndNotify().catch((e) => {
        DebugLogger.error("[ConflictMonitor] 冲突扫描失败", e);
      });
    }, delayMs);
  }

  private clearTimer() {
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private async scanAndNotify() {
    if (this.disposed) {
      return;
    }

    const result = await this.scanAll(this.app.vault);
    const signature = this.buildSignature(result.conflicts);

    if (result.conflicts.length === 0) {
      this.lastSignature = null;
      this.removeToast();
      return;
    }

    if (this.lastSignature === signature && this.toast) {
      return;
    }

    this.lastSignature = signature;
    this.showToast(result);
  }

  private async scanAll(vault: Vault): Promise<ScanResult> {
    const [commandIdResult, variableResult] = await Promise.all([
      CommandIdConflictDetector.detectConflicts(vault),
      VariableConflictVaultScanner.scan(vault),
    ]);

    const conflicts: DetectedConflict[] = [];

    for (const c of commandIdResult.conflicts) {
      conflicts.push({
        kind: "commandId",
        name: c.commandId,
        conflictType: "DUPLICATE",
        items: c.files.map((f: { path: string; name: string }) => ({
          filePath: f.path,
          fileName: f.name,
        })),
      });
    }

    conflicts.push(...variableResult.conflicts);

    return {
      conflicts,
      commandIdConflicts: commandIdResult.conflicts,
      variableConflictsByFile: variableResult.conflictsByFile,
    };
  }

  private buildSignature(conflicts: DetectedConflict[]): string {
    const parts = conflicts
      .map((c) => {
        const items = c.items
          .map((i) => `${i.filePath}|${i.detailPath ?? ""}|${i.source ?? ""}`)
          .sort()
          .join(",");
        return `${c.kind}:${c.name}:${c.conflictType}:${items}`;
      })
      .sort();
    return parts.join("\n");
  }

  private showToast(result: ScanResult) {
    this.removeToast();

    let toastRef: Toast | null = null;

    const closeToast = () => {
      toastRef?.remove();
      toastRef = null;
      this.toast = null;
    };

    const onFixAll = async () => {
      if (result.commandIdConflicts.length > 0) {
        await CommandIdConflictDetector.fixConflicts(
          this.app.vault,
          result.commandIdConflicts
        );
      }

      for (const [filePath, conflicts] of result.variableConflictsByFile.entries()) {
        await VariableConflictAutoFixer.fixFileConflicts(
          this.app.vault,
          filePath,
          conflicts
        );
      }

      await this.scanAndNotify();
    };

    toastRef = ToastManager.warning(
      <ConflictToastContent
        conflicts={result.conflicts}
        onFixAll={onFixAll}
        onClose={closeToast}
      />,
      0
    );

    this.toast = toastRef;
  }

  private removeToast() {
    if (this.toast) {
      try {
        this.toast.remove();
      } catch {
        // ignore
      }
      this.toast = null;
    }
  }
}
