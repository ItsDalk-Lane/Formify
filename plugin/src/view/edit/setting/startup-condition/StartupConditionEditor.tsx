import { useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Play,
  ChevronDown,
  Clock,
  File,
  Settings,
  Code,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
  CopyPlus,
} from "lucide-react";
import { localInstance } from "src/i18n/locals";
import {
  StartupCondition,
  StartupConditionsConfig,
  StartupConditionType,
  ConditionRelation,
  TimeConditionSubType,
  FileConditionSubType,
  SystemConditionSubType,
  ConditionOperator,
  createCondition,
  createConditionGroup,
  createEmptyStartupConditionsConfig,
  getConditionPresets,
} from "src/model/startup-condition/StartupCondition";
import type {
  TimeConditionConfig,
  FileConditionConfig,
  SystemConditionConfig,
  ScriptConditionConfig,
  ConditionPreset,
} from "src/model/startup-condition/StartupCondition";
import {
  getStartupConditionService,
  ConditionEvaluationContext,
  ConditionEvaluationResult,
} from "src/service/startup-condition/StartupConditionService";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { v4 } from "uuid";
import "./StartupConditionEditor.css";

type EditorMode = "simple" | "advanced";

interface StartupConditionEditorProps {
  config: StartupConditionsConfig | undefined;
  onChange: (config: StartupConditionsConfig) => void;
  formFilePath?: string;
}

/**
 * 启动条件编辑器组件
 */
export function StartupConditionEditor(props: StartupConditionEditorProps) {
  const { config, onChange, formFilePath } = props;
  const app = useObsidianApp();
  const [mode, setMode] = useState<EditorMode>("simple");
  const [testResult, setTestResult] = useState<ConditionEvaluationResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // 确保配置存在
  const currentConfig = config || createEmptyStartupConditionsConfig();

  // 切换启用状态
  const handleToggleEnabled = useCallback(() => {
    onChange({
      ...currentConfig,
      enabled: !currentConfig.enabled,
    });
  }, [currentConfig, onChange]);

  // 应用预设
  const handleApplyPreset = useCallback(
    (preset: ConditionPreset) => {
      onChange({
        enabled: true,
        relation: ConditionRelation.And,
        conditions: preset.conditions.map((c) => ({ ...c, id: v4() })),
      });
    },
    [onChange]
  );

  // 添加条件
  const handleAddCondition = useCallback(
    (type: StartupConditionType) => {
      const newCondition = createCondition(type);
      onChange({
        ...currentConfig,
        enabled: true,
        conditions: [...currentConfig.conditions, newCondition],
      });
    },
    [currentConfig, onChange]
  );

  // 添加条件组
  const handleAddGroup = useCallback(() => {
    const newGroup = createConditionGroup();
    onChange({
      ...currentConfig,
      enabled: true,
      conditions: [...currentConfig.conditions, newGroup],
    });
  }, [currentConfig, onChange]);

  // 删除条件
  const handleRemoveCondition = useCallback(
    (id: string) => {
      onChange({
        ...currentConfig,
        conditions: currentConfig.conditions.filter((c) => c.id !== id),
      });
    },
    [currentConfig, onChange]
  );

  // 复制条件
  const handleDuplicateCondition = useCallback(
    (id: string) => {
      const condition = currentConfig.conditions.find((c) => c.id === id);
      if (condition) {
        const newCondition = { ...condition, id: v4() };
        onChange({
          ...currentConfig,
          conditions: [...currentConfig.conditions, newCondition],
        });
      }
    },
    [currentConfig, onChange]
  );

  // 更新条件
  const handleUpdateCondition = useCallback(
    (id: string, updates: Partial<StartupCondition>) => {
      onChange({
        ...currentConfig,
        conditions: currentConfig.conditions.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      });
    },
    [currentConfig, onChange]
  );

  // 更改根逻辑关系
  const handleRelationChange = useCallback(
    (relation: ConditionRelation) => {
      onChange({
        ...currentConfig,
        relation,
      });
    },
    [currentConfig, onChange]
  );

  // 测试条件
  const handleTestConditions = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const conditionService = getStartupConditionService();
      const context: ConditionEvaluationContext = {
        app,
        currentFile: app.workspace.getActiveFile(),
        formFilePath,
      };

      const result = await conditionService.testConditions(currentConfig, context);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        satisfied: false,
        details: `测试失败: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTesting(false);
    }
  }, [app, currentConfig, formFilePath]);

  // 清除条件
  const handleClearConditions = useCallback(() => {
    onChange({
      ...currentConfig,
      conditions: [],
    });
  }, [currentConfig, onChange]);

  return (
    <div className="form--StartupConditionEditor">
      <div className="form--StartupConditionHeader">
        <div className="form--StartupConditionTitle">
          <Clock size={16} />
          <span>{localInstance.startup_conditions}</span>
          <button
            className="form--ToggleButton"
            onClick={handleToggleEnabled}
            title={currentConfig.enabled ? localInstance.enabled : localInstance.disabled}
          >
            {currentConfig.enabled ? (
              <ToggleRight size={20} className="text-accent" />
            ) : (
              <ToggleLeft size={20} />
            )}
          </button>
        </div>
        <div className="form--StartupConditionModeSwitch">
          <button
            className={mode === "simple" ? "active" : ""}
            onClick={() => setMode("simple")}
          >
            {localInstance.startup_condition_mode_simple}
          </button>
          <button
            className={mode === "advanced" ? "active" : ""}
            onClick={() => setMode("advanced")}
          >
            {localInstance.startup_condition_mode_advanced}
          </button>
        </div>
      </div>

      {currentConfig.enabled && (
        <>
          {mode === "simple" ? (
            <SimpleConditionEditor
              config={currentConfig}
              onApplyPreset={handleApplyPreset}
            />
          ) : (
            <AdvancedConditionEditor
              config={currentConfig}
              onAddCondition={handleAddCondition}
              onAddGroup={handleAddGroup}
              onRemoveCondition={handleRemoveCondition}
              onDuplicateCondition={handleDuplicateCondition}
              onUpdateCondition={handleUpdateCondition}
              onRelationChange={handleRelationChange}
              onClear={handleClearConditions}
            />
          )}

          <div className="form--StartupConditionFooter">
            <button
              className="form--StartupConditionTestButton"
              onClick={handleTestConditions}
              disabled={isTesting}
            >
              <Play size={14} />
              {isTesting ? localInstance.testing : localInstance.test_condition}
            </button>

            {testResult && (
              <div
                className={`form--StartupConditionTestResult ${
                  testResult.satisfied ? "success" : "failure"
                }`}
              >
                {testResult.satisfied ? <Check size={14} /> : <X size={14} />}
                <span>{testResult.details}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 简单模式编辑器
 */
function SimpleConditionEditor(props: {
  config: StartupConditionsConfig;
  onApplyPreset: (preset: ConditionPreset) => void;
}) {
  const { config, onApplyPreset } = props;
  const presets = getConditionPresets();

  // 检查当前配置是否匹配预设
  const getSelectedPresetId = (): string | null => {
    // 简单检查：比较条件数量和类型
    for (const preset of presets) {
      if (
        config.conditions.length === preset.conditions.length &&
        config.conditions.every((c, i) => {
          const presetCondition = preset.conditions[i];
          if (c.type !== presetCondition.type) return false;
          const cConfig = c.config as TimeConditionConfig;
          const pConfig = presetCondition.config as TimeConditionConfig;
          return cConfig?.subType === pConfig?.subType;
        })
      ) {
        return preset.id;
      }
    }
    return null;
  };

  const selectedPresetId = getSelectedPresetId();

  return (
    <div className="form--StartupConditionPresets">
      {presets.map((preset) => (
        <div
          key={preset.id}
          className={`form--StartupConditionPresetCard ${
            selectedPresetId === preset.id ? "selected" : ""
          }`}
          onClick={() => onApplyPreset(preset)}
        >
          <span className="form--StartupConditionPresetName">
            {localInstance[preset.name as keyof typeof localInstance] || preset.name}
          </span>
          <span className="form--StartupConditionPresetDesc">
            {localInstance[preset.description as keyof typeof localInstance] ||
              preset.description}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 高级模式编辑器
 */
function AdvancedConditionEditor(props: {
  config: StartupConditionsConfig;
  onAddCondition: (type: StartupConditionType) => void;
  onAddGroup: () => void;
  onRemoveCondition: (id: string) => void;
  onDuplicateCondition: (id: string) => void;
  onUpdateCondition: (id: string, updates: Partial<StartupCondition>) => void;
  onRelationChange: (relation: ConditionRelation) => void;
  onClear: () => void;
}) {
  const {
    config,
    onAddCondition,
    onAddGroup,
    onRemoveCondition,
    onDuplicateCondition,
    onUpdateCondition,
    onRelationChange,
    onClear,
  } = props;

  const [showAddMenu, setShowAddMenu] = useState(false);

  return (
    <div className="form--StartupConditionAdvanced">
      {/* 根关系选择 */}
      {config.conditions.length > 1 && (
        <div className="form--StartupConditionGroupRelation">
          <span>{localInstance.condition_relation}:</span>
          <select
            className="form--RelationDropdown"
            value={config.relation}
            onChange={(e) => onRelationChange(e.target.value as ConditionRelation)}
          >
            <option value={ConditionRelation.And}>{localInstance.operator_and}</option>
            <option value={ConditionRelation.Or}>{localInstance.operator_or}</option>
          </select>
        </div>
      )}

      {/* 条件列表 */}
      <div className="form--StartupConditionList">
        {config.conditions.map((condition, index) => (
          <ConditionItem
            key={condition.id}
            condition={condition}
            index={index}
            relation={config.relation}
            onUpdate={(updates) => onUpdateCondition(condition.id, updates)}
            onRemove={() => onRemoveCondition(condition.id)}
            onDuplicate={() => onDuplicateCondition(condition.id)}
          />
        ))}
      </div>

      {/* 添加按钮 */}
      <div style={{ position: "relative" }}>
        <button
          className="form--StartupConditionAddButton"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          <Plus size={14} />
          {localInstance.add_condition}
          <ChevronDown size={14} />
        </button>

        {showAddMenu && (
          <AddConditionMenu
            onAddCondition={(type) => {
              onAddCondition(type);
              setShowAddMenu(false);
            }}
            onAddGroup={() => {
              onAddGroup();
              setShowAddMenu(false);
            }}
            onClose={() => setShowAddMenu(false)}
          />
        )}
      </div>

      {/* 清除按钮 */}
      {config.conditions.length > 0 && (
        <button
          className="form--StartupConditionAddButton"
          style={{ color: "var(--text-error)" }}
          onClick={onClear}
        >
          <Trash2 size={14} />
          {localInstance.clear_condition}
        </button>
      )}
    </div>
  );
}

/**
 * 添加条件菜单
 */
function AddConditionMenu(props: {
  onAddCondition: (type: StartupConditionType) => void;
  onAddGroup: () => void;
  onClose: () => void;
}) {
  const { onAddCondition, onAddGroup, onClose } = props;

  const conditionTypes = [
    {
      type: StartupConditionType.Time,
      icon: <Clock size={14} />,
      label: localInstance.startup_condition_type_time,
    },
    {
      type: StartupConditionType.File,
      icon: <File size={14} />,
      label: localInstance.startup_condition_type_file,
    },
    {
      type: StartupConditionType.System,
      icon: <Settings size={14} />,
      label: localInstance.startup_condition_type_system,
    },
    {
      type: StartupConditionType.Script,
      icon: <Code size={14} />,
      label: localInstance.startup_condition_type_script,
    },
  ];

  return (
    <div
      className="form--AddConditionMenu"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 100,
        background: "var(--background-primary)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "6px",
        padding: "4px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        minWidth: "160px",
      }}
    >
      {conditionTypes.map((item) => (
        <button
          key={item.type}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            padding: "8px 12px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            borderRadius: "4px",
            fontSize: "12px",
            color: "var(--text-normal)",
          }}
          onClick={() => onAddCondition(item.type)}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--background-modifier-hover)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <div
        style={{
          height: "1px",
          background: "var(--background-modifier-border)",
          margin: "4px 0",
        }}
      />
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "8px 12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: "4px",
          fontSize: "12px",
          color: "var(--text-normal)",
        }}
        onClick={onAddGroup}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--background-modifier-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <CopyPlus size={14} />
        {localInstance.add_condition_group}
      </button>
    </div>
  );
}

/**
 * 单个条件项
 */
function ConditionItem(props: {
  condition: StartupCondition;
  index: number;
  relation: ConditionRelation;
  onUpdate: (updates: Partial<StartupCondition>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { condition, index, relation, onUpdate, onRemove, onDuplicate } = props;

  const getRelationText = () => {
    if (index === 0) return localInstance.operator_condition;
    return relation === ConditionRelation.And
      ? localInstance.operator_and
      : localInstance.operator_or;
  };

  return (
    <div className={`form--StartupConditionItem ${condition.enabled ? "" : "disabled"}`}>
      <div className="form--StartupConditionRelation">{getRelationText()}</div>

      <div className="form--StartupConditionContent">
        {condition.type === "group" ? (
          <ConditionGroupEditor
            condition={condition}
            onUpdate={onUpdate}
          />
        ) : (
          <ConditionConfigEditor
            condition={condition}
            onUpdate={onUpdate}
          />
        )}
      </div>

      <div className="form--StartupConditionActions">
        <button
          onClick={() => onUpdate({ enabled: !condition.enabled })}
          title={condition.enabled ? localInstance.disable : localInstance.enable}
        >
          {condition.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
        </button>
        <button onClick={onDuplicate} title={localInstance.duplicate}>
          <Copy size={14} />
        </button>
        <button onClick={onRemove} data-type="danger" title={localInstance.delete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * 条件组编辑器
 */
function ConditionGroupEditor(props: {
  condition: StartupCondition;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, onUpdate } = props;

  const handleAddCondition = (type: StartupConditionType) => {
    const newCondition = createCondition(type);
    onUpdate({
      conditions: [...(condition.conditions || []), newCondition],
    });
  };

  const handleRemoveChild = (id: string) => {
    onUpdate({
      conditions: (condition.conditions || []).filter((c) => c.id !== id),
    });
  };

  const handleUpdateChild = (id: string, updates: Partial<StartupCondition>) => {
    onUpdate({
      conditions: (condition.conditions || []).map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    });
  };

  return (
    <div className="form--StartupConditionGroup">
      <div className="form--StartupConditionGroupHeader">
        <div className="form--StartupConditionGroupRelation">
          <span>{localInstance.condition_group}</span>
          <select
            className="form--RelationDropdown"
            value={condition.relation}
            onChange={(e) => onUpdate({ relation: e.target.value as ConditionRelation })}
          >
            <option value={ConditionRelation.And}>{localInstance.operator_and}</option>
            <option value={ConditionRelation.Or}>{localInstance.operator_or}</option>
          </select>
        </div>
      </div>

      <div className="form--StartupConditionList">
        {(condition.conditions || []).map((child, index) => (
          <ConditionItem
            key={child.id}
            condition={child}
            index={index}
            relation={condition.relation}
            onUpdate={(updates) => handleUpdateChild(child.id, updates)}
            onRemove={() => handleRemoveChild(child.id)}
            onDuplicate={() => {
              const newChild = { ...child, id: v4() };
              onUpdate({
                conditions: [...(condition.conditions || []), newChild],
              });
            }}
          />
        ))}
      </div>

      <button
        className="form--StartupConditionAddButton"
        onClick={() => handleAddCondition(StartupConditionType.Time)}
      >
        <Plus size={14} />
        {localInstance.add_condition}
      </button>
    </div>
  );
}

/**
 * 条件配置编辑器
 */
function ConditionConfigEditor(props: {
  condition: StartupCondition;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, onUpdate } = props;

  const getTypeIcon = () => {
    switch (condition.type) {
      case StartupConditionType.Time:
        return <Clock size={14} />;
      case StartupConditionType.File:
        return <File size={14} />;
      case StartupConditionType.System:
        return <Settings size={14} />;
      case StartupConditionType.Script:
        return <Code size={14} />;
      default:
        return null;
    }
  };

  const getTypeLabel = () => {
    switch (condition.type) {
      case StartupConditionType.Time:
        return localInstance.startup_condition_type_time;
      case StartupConditionType.File:
        return localInstance.startup_condition_type_file;
      case StartupConditionType.System:
        return localInstance.startup_condition_type_system;
      case StartupConditionType.Script:
        return localInstance.startup_condition_type_script;
      default:
        return "";
    }
  };

  return (
    <div>
      <div className="form--StartupConditionTypeRow">
        {getTypeIcon()}
        <span style={{ fontWeight: 500 }}>{getTypeLabel()}</span>
      </div>

      {condition.type === StartupConditionType.Time && (
        <TimeConditionConfigEditor
          config={condition.config as TimeConditionConfig}
          onChange={(config) => onUpdate({ config })}
        />
      )}

      {condition.type === StartupConditionType.File && (
        <FileConditionConfigEditor
          config={condition.config as FileConditionConfig}
          onChange={(config) => onUpdate({ config })}
        />
      )}

      {condition.type === StartupConditionType.System && (
        <SystemConditionConfigEditor
          config={condition.config as SystemConditionConfig}
          onChange={(config) => onUpdate({ config })}
        />
      )}

      {condition.type === StartupConditionType.Script && (
        <ScriptConditionConfigEditor
          config={condition.config as ScriptConditionConfig}
          onChange={(config) => onUpdate({ config })}
        />
      )}
    </div>
  );
}

/**
 * 时间条件配置
 */
function TimeConditionConfigEditor(props: {
  config: TimeConditionConfig;
  onChange: (config: TimeConditionConfig) => void;
}) {
  const { config, onChange } = props;

  const dayNames = [
    localInstance.sunday,
    localInstance.monday,
    localInstance.tuesday,
    localInstance.wednesday,
    localInstance.thursday,
    localInstance.friday,
    localInstance.saturday,
  ];

  return (
    <div className="form--StartupConditionConfigRow">
      <label>{localInstance.startup_condition_subtype}:</label>
      <select
        value={config.subType}
        onChange={(e) =>
          onChange({ ...config, subType: e.target.value as TimeConditionSubType })
        }
      >
        <option value={TimeConditionSubType.TimeRange}>
          {localInstance.startup_condition_time_range}
        </option>
        <option value={TimeConditionSubType.DayOfWeek}>
          {localInstance.startup_condition_day_of_week}
        </option>
        <option value={TimeConditionSubType.DateRange}>
          {localInstance.startup_condition_date_range}
        </option>
        <option value={TimeConditionSubType.LastExecutionInterval}>
          {localInstance.startup_condition_interval}
        </option>
      </select>

      {config.subType === TimeConditionSubType.TimeRange && (
        <>
          <input
            type="time"
            value={config.startTime || "09:00"}
            onChange={(e) => onChange({ ...config, startTime: e.target.value })}
          />
          <span>-</span>
          <input
            type="time"
            value={config.endTime || "18:00"}
            onChange={(e) => onChange({ ...config, endTime: e.target.value })}
          />
        </>
      )}

      {config.subType === TimeConditionSubType.DayOfWeek && (
        <div className="form--DayOfWeekPicker">
          {dayNames.map((name, index) => (
            <button
              key={index}
              className={(config.daysOfWeek || []).includes(index) ? "selected" : ""}
              onClick={() => {
                const days = config.daysOfWeek || [];
                const newDays = days.includes(index)
                  ? days.filter((d) => d !== index)
                  : [...days, index];
                onChange({ ...config, daysOfWeek: newDays });
              }}
            >
              {name.substring(0, 1)}
            </button>
          ))}
        </div>
      )}

      {config.subType === TimeConditionSubType.DateRange && (
        <>
          <input
            type="date"
            value={config.startDate || ""}
            onChange={(e) => onChange({ ...config, startDate: e.target.value })}
          />
          <span>-</span>
          <input
            type="date"
            value={config.endDate || ""}
            onChange={(e) => onChange({ ...config, endDate: e.target.value })}
          />
        </>
      )}

      {config.subType === TimeConditionSubType.LastExecutionInterval && (
        <>
          <input
            type="number"
            min="1"
            value={config.intervalMinutes || 60}
            onChange={(e) =>
              onChange({ ...config, intervalMinutes: parseInt(e.target.value, 10) || 60 })
            }
          />
          <span>{localInstance.minutes}</span>
        </>
      )}
    </div>
  );
}

/**
 * 文件条件配置
 */
function FileConditionConfigEditor(props: {
  config: FileConditionConfig;
  onChange: (config: FileConditionConfig) => void;
}) {
  const { config, onChange } = props;

  return (
    <div className="form--StartupConditionConfigRow">
      <label>{localInstance.startup_condition_subtype}:</label>
      <select
        value={config.subType}
        onChange={(e) =>
          onChange({ ...config, subType: e.target.value as FileConditionSubType })
        }
      >
        <option value={FileConditionSubType.FileExists}>
          {localInstance.startup_condition_file_exists}
        </option>
        <option value={FileConditionSubType.PathMatch}>
          {localInstance.startup_condition_path_match}
        </option>
        <option value={FileConditionSubType.ContentContains}>
          {localInstance.startup_condition_content_contains}
        </option>
        <option value={FileConditionSubType.FrontmatterProperty}>
          {localInstance.startup_condition_frontmatter}
        </option>
      </select>

      {config.subType === FileConditionSubType.PathMatch && (
        <input
          type="text"
          placeholder={localInstance.startup_condition_path_pattern_placeholder}
          value={config.pathPattern || ""}
          onChange={(e) => onChange({ ...config, pathPattern: e.target.value })}
          style={{ flex: 1, minWidth: 200 }}
        />
      )}

      {config.subType === FileConditionSubType.ContentContains && (
        <input
          type="text"
          placeholder={localInstance.startup_condition_search_text_placeholder}
          value={config.searchText || ""}
          onChange={(e) => onChange({ ...config, searchText: e.target.value })}
          style={{ flex: 1, minWidth: 200 }}
        />
      )}

      {config.subType === FileConditionSubType.FrontmatterProperty && (
        <>
          <input
            type="text"
            placeholder={localInstance.property_name}
            value={config.propertyName || ""}
            onChange={(e) => onChange({ ...config, propertyName: e.target.value })}
            style={{ width: 100 }}
          />
          <select
            value={config.operator || ConditionOperator.Equals}
            onChange={(e) =>
              onChange({ ...config, operator: e.target.value as ConditionOperator })
            }
          >
            <option value={ConditionOperator.Equals}>{localInstance.equal}</option>
            <option value={ConditionOperator.NotEquals}>{localInstance.not_equal}</option>
            <option value={ConditionOperator.Contains}>{localInstance.contains}</option>
          </select>
          <input
            type="text"
            placeholder={localInstance.property_value}
            value={config.propertyValue || ""}
            onChange={(e) => onChange({ ...config, propertyValue: e.target.value })}
            style={{ width: 100 }}
          />
        </>
      )}
    </div>
  );
}

/**
 * 系统条件配置
 */
function SystemConditionConfigEditor(props: {
  config: SystemConditionConfig;
  onChange: (config: SystemConditionConfig) => void;
}) {
  const { config, onChange } = props;

  return (
    <div className="form--StartupConditionConfigRow">
      <label>{localInstance.startup_condition_subtype}:</label>
      <select
        value={config.subType}
        onChange={(e) =>
          onChange({ ...config, subType: e.target.value as SystemConditionSubType })
        }
      >
        <option value={SystemConditionSubType.PluginVersion}>
          {localInstance.startup_condition_plugin_version}
        </option>
        <option value={SystemConditionSubType.ObsidianVersion}>
          {localInstance.startup_condition_obsidian_version}
        </option>
        <option value={SystemConditionSubType.WorkspaceLayout}>
          {localInstance.startup_condition_workspace_layout}
        </option>
      </select>

      {(config.subType === SystemConditionSubType.PluginVersion ||
        config.subType === SystemConditionSubType.ObsidianVersion) && (
        <>
          <select
            value={config.operator || ConditionOperator.GreaterThanOrEqual}
            onChange={(e) =>
              onChange({ ...config, operator: e.target.value as ConditionOperator })
            }
          >
            <option value={ConditionOperator.Equals}>{localInstance.equal}</option>
            <option value={ConditionOperator.GreaterThan}>{localInstance.greater_than}</option>
            <option value={ConditionOperator.GreaterThanOrEqual}>
              {localInstance.greater_than_or_equal}
            </option>
            <option value={ConditionOperator.LessThan}>{localInstance.less_than}</option>
            <option value={ConditionOperator.LessThanOrEqual}>
              {localInstance.less_than_or_equal}
            </option>
          </select>
          <input
            type="text"
            placeholder="1.0.0"
            value={config.version || ""}
            onChange={(e) => onChange({ ...config, version: e.target.value })}
            style={{ width: 80 }}
          />
        </>
      )}

      {config.subType === SystemConditionSubType.WorkspaceLayout && (
        <select
          value={config.layoutType || ""}
          onChange={(e) => onChange({ ...config, layoutType: e.target.value })}
        >
          <option value="">{localInstance.please_select_option}</option>
          <option value="single">{localInstance.startup_condition_layout_single}</option>
          <option value="split">{localInstance.startup_condition_layout_split}</option>
        </select>
      )}
    </div>
  );
}

/**
 * 脚本条件配置
 */
function ScriptConditionConfigEditor(props: {
  config: ScriptConditionConfig;
  onChange: (config: ScriptConditionConfig) => void;
}) {
  const { config, onChange } = props;

  return (
    <div className="form--StartupConditionConfigRow" style={{ flexDirection: "column" }}>
      <label>{localInstance.startup_condition_script_expression}:</label>
      <textarea
        className="form--ScriptEditor"
        placeholder={localInstance.startup_condition_script_placeholder}
        value={config.expression || ""}
        onChange={(e) => onChange({ ...config, expression: e.target.value })}
      />
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {localInstance.startup_condition_script_help}
      </span>
    </div>
  );
}
