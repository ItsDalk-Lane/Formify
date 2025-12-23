import { AlertTriangle, Wrench } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { localInstance } from "src/i18n/locals";
import { DetectedConflict } from "src/service/conflict/ConflictTypes";
import "./ConflictToastContent.css";

export default function ConflictToastContent(props: {
  conflicts: DetectedConflict[];
  onFixAll: () => Promise<void>;
  onClose: () => void;
}) {
  const { conflicts, onFixAll, onClose } = props;
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const commandIds = conflicts.filter((c) => c.kind === "commandId");
    const variables = conflicts.filter((c) => c.kind === "variable");
    return { commandIds, variables };
  }, [conflicts]);

  const handleFix = useCallback(async () => {
    if (fixing) {
      return;
    }
    setFixing(true);
    setError(null);
    try {
      await onFixAll();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFixing(false);
    }
  }, [fixing, onFixAll, onClose]);

  return (
    <div className="form--ConflictToast">
      <div className="form--ConflictToast__header">
        <strong className="form--ConflictToast__title">检测到冲突</strong>
        <div className="form--ConflictToast__actions">
          <button
            className="form--ConflictToast__fixButton"
            onClick={handleFix}
            disabled={fixing}
          >
            <Wrench size={16} />
            {fixing ? "正在修复..." : "一键修改"}
          </button>
        </div>
      </div>

      {error && (
        <div className="form--ConflictToast__error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="form--ConflictToast__body">
        {grouped.commandIds.length > 0 && (
          <section className="form--ConflictToast__section">
            <div className="form--ConflictToast__sectionTitle">
              <span className="form--ConflictToast__badge">命令ID</span>
              <span>
				命令ID冲突 × {grouped.commandIds.length}
              </span>
            </div>
            <div className="form--ConflictToast__list">
              {grouped.commandIds.map((c) => (
                <div key={`cmd-${c.name}`} className="form--ConflictToast__item">
                  <div className="form--ConflictToast__itemHeader">
                    <code className="form--ConflictToast__code">{c.name}</code>
                  </div>
                  <div className="form--ConflictToast__itemDetails">
                    {c.items.map((it, idx) => (
                      <div key={`${it.filePath}-${idx}`} className="form--ConflictToast__line">
                        <span className="form--ConflictToast__fileName">{it.fileName}</span>
                        <code className="form--ConflictToast__path">{it.filePath}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {grouped.variables.length > 0 && (
          <section className="form--ConflictToast__section">
            <div className="form--ConflictToast__sectionTitle">
              <span className="form--ConflictToast__badge">变量</span>
              <span>
                {localInstance.has_conflicts} × {grouped.variables.length}
              </span>
            </div>
            <div className="form--ConflictToast__list">
              {grouped.variables.map((c, index) => (
                <div key={`var-${c.name}-${index}`} className="form--ConflictToast__item">
                  <div className="form--ConflictToast__itemHeader">
                    <code className="form--ConflictToast__code">{c.name}</code>
                    <span className="form--ConflictToast__meta">{c.conflictType}</span>
                  </div>
                  <div className="form--ConflictToast__itemDetails">
                    {c.items.map((it, idx) => (
                      <div key={`${it.filePath}-${it.detailPath ?? "-"}-${idx}`} className="form--ConflictToast__line">
                        <span className="form--ConflictToast__fileName">{it.fileName}</span>
                        <code className="form--ConflictToast__path">{it.filePath}</code>
                        {it.source && <span className="form--ConflictToast__meta">{it.source}</span>}
                        {it.detailPath && <code className="form--ConflictToast__path">{it.detailPath}</code>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {conflicts.length === 0 && (
          <div className="form--ConflictToast__empty">{localInstance.no_conflicts}</div>
        )}
      </div>
    </div>
  );
}
