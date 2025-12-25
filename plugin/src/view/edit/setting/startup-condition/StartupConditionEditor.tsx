import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
  AlertCircle,
  Variable,
} from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { week } from "src/i18n/week";
import {
  StartupCondition,
  StartupConditionsConfig,
  StartupConditionType,
  ConditionRelation,
  TimeConditionSubType,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
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
  PropertyCheckConfig,
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
import { TFile } from "obsidian";
import { v4 } from "uuid";
import "./StartupConditionEditor.css";
import { FormConfig } from "src/model/FormConfig";
import { FormField } from "src/model/field/IFormField";

/**
 * 允许的内置变量类型（用于启动条件）
 * 排除 selection 和 clipboard，因为它们需要用户交互
 */
const ALLOWED_BUILTIN_VARIABLES = [
  { name: "date", pattern: "{{date}}", description: localInstance.builtin_var_date || "当前日期" },
  { name: "date:format", pattern: "{{date:YYYY-MM-DD}}", description: localInstance.builtin_var_date_format || "格式化日期" },
  { name: "time", pattern: "{{time}}", description: localInstance.builtin_var_time || "当前时间" },
  { name: "random", pattern: "{{random:10}}", description: localInstance.builtin_var_random || "随机字符串" },
];

/**
 * 获取可用的表单变量（只返回有默认值的字段）
 */
function getAvailableFormVariables(formConfig?: FormConfig): { name: string; label: string; defaultValue: any }[] {
  if (!formConfig || !formConfig.fields) return [];
  
  return formConfig.fields
    .filter((field: FormField) => field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "")
    .map((field: FormField) => ({
      name: field.label,
      label: field.label,
      defaultValue: field.defaultValue,
    }));
}

/**
 * 变量引用输入组件
 * 支持引用表单变量和内置变量
 */
/**
 * 变量引用输入组件
 * 支持引用表单变量和内置变量
 * 支持文件搜索建议
 */
interface VariableReferenceInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  formConfig?: FormConfig;
  style?: React.CSSProperties;
  enableFileSearch?: boolean;
}

function VariableReferenceInput(props: VariableReferenceInputProps) {
  const { value, onChange, placeholder, formConfig, style, enableFileSearch } = props;
  const app = useObsidianApp();
  const [showDropdown, setShowDropdown] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<TFile[]>([]);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileDropdownRef = useRef<HTMLDivElement>(null);

  const formVariables = useMemo(() => getAvailableFormVariables(formConfig), [formConfig]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Close variable dropdown
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }

      // Close file dropdown
      if (
        fileDropdownRef.current &&
        !fileDropdownRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target)
      ) {
        setShowFileDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle input change with file search
  const handleInputChange = (newValue: string) => {
    onChange(newValue);
    
    if (enableFileSearch && newValue.trim()) {
      const search = newValue.toLowerCase();
      const files = app.vault.getFiles();
      const matches = files
        .filter(f => f.path.toLowerCase().includes(search))
        .slice(0, 10);
      
      if (matches.length > 0) {
        setFileSuggestions(matches);
        setShowFileDropdown(true);
        setShowDropdown(false);
      } else {
        setShowFileDropdown(false);
      }
    } else {
      setShowFileDropdown(false);
    }
  };

  // Select file from suggestions
  const selectFile = (file: TFile) => {
    onChange(file.path);
    setShowFileDropdown(false);
    inputRef.current?.focus();
  };

  // 插入变量引用
  const insertVariable = (variablePattern: string) => {
    const input = inputRef.current;
    if (!input) {
      onChange(value + variablePattern);
      setShowDropdown(false);
      return;
    }

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const newValue = value.substring(0, start) + variablePattern + value.substring(end);
    onChange(newValue);
    setShowDropdown(false);
    setShowFileDropdown(false);

    // 设置光标位置
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variablePattern.length, start + variablePattern.length);
    }, 0);
  };

  return (
    <div className="form--VariableReferenceInput" style={{ position: "relative", ...style }}>
      <div className="form--VariableReferenceInputWrapper">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          className="form--VariableReferenceInputField"
          autoComplete="off"
        />
        <button
          type="button"
          className="form--VariableReferenceButton"
          onClick={() => {
            setShowDropdown(!showDropdown);
            setShowFileDropdown(false);
          }}
          title={localInstance.insert_variable || "插入变量"}
        >
          <Variable size={14} />
        </button>
      </div>

      {showDropdown && (
        <div ref={dropdownRef} className="form--VariableReferenceDropdown">
          {/* 表单变量部分 */}
          {formVariables.length > 0 && (
            <>
              <div className="form--VariableReferenceSection">
                <span className="form--VariableReferenceSectionTitle">
                  {localInstance.form_variables || "表单变量"}
                </span>
              </div>
              {formVariables.map((v) => (
                <div
                  key={v.name}
                  className="form--VariableReferenceItem"
                  onClick={() => insertVariable(`{{@${v.name}}}`)}
                >
                  <span className="form--VariableReferenceName">{"{{@" + v.name + "}}"}</span>
                  <span className="form--VariableReferenceDesc">
                    {localInstance.default_value || "默认值"}: {String(v.defaultValue)}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* 内置变量部分 */}
          <div className="form--VariableReferenceSection">
            <span className="form--VariableReferenceSectionTitle">
              {localInstance.builtin_variables || "内置变量"}
            </span>
          </div>
          {ALLOWED_BUILTIN_VARIABLES.map((v) => (
            <div
              key={v.name}
              className="form--VariableReferenceItem"
              onClick={() => insertVariable(v.pattern)}
            >
              <span className="form--VariableReferenceName">{v.pattern}</span>
              <span className="form--VariableReferenceDesc">{v.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* File Suggestions Dropdown */}
      {showFileDropdown && (
        <div ref={fileDropdownRef} className="form--VariableReferenceDropdown">
          {fileSuggestions.map((file) => (
            <div
              key={file.path}
              className="form--VariableReferenceItem"
              onClick={() => selectFile(file)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                <File size={14} className="text-muted" style={{ flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <span className="form--VariableReferenceName" style={{ color: "var(--text-normal)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {file.name}
                  </span>
                  <span className="form--VariableReferenceDesc" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {file.path}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type EditorMode = "simple" | "advanced";

interface StartupConditionEditorProps {
  config: StartupConditionsConfig | undefined;
  onChange: (config: StartupConditionsConfig) => void;
  formFilePath?: string;
  formConfig?: FormConfig;
}

/**
 * 启动条件编辑器组件
 */
export function StartupConditionEditor(props: StartupConditionEditorProps) {
  const { config, onChange, formFilePath, formConfig } = props;
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
      <div className="form--StartupConditionControls">
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
              formConfig={formConfig}
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
  formConfig?: FormConfig;
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
    formConfig,
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
            formConfig={formConfig}
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
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { condition, index, relation, formConfig, onUpdate, onRemove, onDuplicate } = props;

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
            formConfig={formConfig}
            onUpdate={onUpdate}
          />
        ) : (
          <ConditionConfigEditor
            condition={condition}
            formConfig={formConfig}
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
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, formConfig, onUpdate } = props;

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
            formConfig={formConfig}
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
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, formConfig, onUpdate } = props;

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
          formConfig={formConfig}
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

  // 使用短名称显示星期几 (日、一、二、三、四、五、六)
  const dayShortNames = [0, 1, 2, 3, 4, 5, 6].map(i => week(i, 'short'));

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
          {dayShortNames.map((name, index) => (
            <button
              key={index}
              className={(config.daysOfWeek || []).includes(index) ? "selected" : ""}
              title={week(index, 'full')}
              onClick={() => {
                const days = config.daysOfWeek || [];
                const newDays = days.includes(index)
                  ? days.filter((d) => d !== index)
                  : [...days, index];
                onChange({ ...config, daysOfWeek: newDays });
              }}
            >
              {name}
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
  formConfig?: FormConfig;
  onChange: (config: FileConditionConfig) => void;
}) {
  const { config, formConfig, onChange } = props;

  // 获取当前目标模式，默认为当前文件
  const targetMode = config.targetMode || FileTargetMode.CurrentFile;
  const isSpecificFile = targetMode === FileTargetMode.SpecificFile;

  // 根据目标模式获取可用的子类型
  const getAvailableSubTypes = () => {
    if (isSpecificFile) {
      // 指定具体文件模式：所有子类型都可用
      return [
        { value: FileConditionSubType.FileExists, label: localInstance.startup_condition_file_exists },
        { value: FileConditionSubType.FileStatus, label: localInstance.startup_condition_file_status },
        { value: FileConditionSubType.ContentContains, label: localInstance.startup_condition_content_contains },
        { value: FileConditionSubType.FrontmatterProperty, label: localInstance.startup_condition_frontmatter },
      ];
    } else {
      // 当前文件模式：只有内容包含和属性检查可用
      return [
        { value: FileConditionSubType.ContentContains, label: localInstance.startup_condition_content_contains },
        { value: FileConditionSubType.FrontmatterProperty, label: localInstance.startup_condition_frontmatter },
      ];
    }
  };

  const availableSubTypes = getAvailableSubTypes();

  // 当切换目标模式时，检查并修正子类型
  const handleTargetModeChange = (newMode: FileTargetMode) => {
    let newConfig = { ...config, targetMode: newMode };
    
    // 如果切换到当前文件模式，且当前子类型是仅指定文件可用的，则切换到内容包含
    if (newMode === FileTargetMode.CurrentFile) {
      if (config.subType === FileConditionSubType.FileExists || 
          config.subType === FileConditionSubType.FileStatus) {
        newConfig.subType = FileConditionSubType.ContentContains;
      }
    }
    
    onChange(newConfig);
  };

  // 处理属性列表变更
  const handleAddProperty = () => {
    const properties = config.properties || [];
    onChange({
      ...config,
      properties: [...properties, { name: "", operator: ConditionOperator.Equals, value: "" }],
    });
  };

  const handleRemoveProperty = (index: number) => {
    const properties = config.properties || [];
    onChange({
      ...config,
      properties: properties.filter((_, i) => i !== index),
    });
  };

  const handleUpdateProperty = (index: number, updates: Partial<PropertyCheckConfig>) => {
    const properties = config.properties || [];
    onChange({
      ...config,
      properties: properties.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    });
  };

  // 处理文件状态检查选项变更
  const handleFileStatusCheckChange = (checkType: FileStatusCheckType, checked: boolean) => {
    const currentChecks = config.fileStatusChecks || [];
    let newChecks: FileStatusCheckType[];
    if (checked) {
      newChecks = [...currentChecks, checkType];
    } else {
      newChecks = currentChecks.filter((c) => c !== checkType);
    }
    onChange({ ...config, fileStatusChecks: newChecks });
  };

  return (
    <div className="form--StartupConditionFileConfig">
      {/* 目标文件模式选择 */}
      <div className="form--StartupConditionConfigRow">
        <label>{localInstance.startup_condition_target_mode}:</label>
        <select
          value={targetMode}
          onChange={(e) => handleTargetModeChange(e.target.value as FileTargetMode)}
        >
          <option value={FileTargetMode.CurrentFile}>
            {localInstance.startup_condition_current_file}
          </option>
          <option value={FileTargetMode.SpecificFile}>
            {localInstance.startup_condition_specific_file}
          </option>
        </select>
      </div>

      {/* 指定文件路径输入 */}
      {isSpecificFile && (
        <div className="form--StartupConditionConfigRow">
          <label>{localInstance.file_path}:</label>
          <VariableReferenceInput
            placeholder={localInstance.startup_condition_file_path_placeholder}
            value={config.targetFilePath || ""}
            onChange={(value) => onChange({ ...config, targetFilePath: value })}
            formConfig={formConfig}
            style={{ flex: 1, minWidth: 200 }}
            enableFileSearch={true}
          />
        </div>
      )}

      {/* 条件子类型选择 */}
      <div className="form--StartupConditionConfigRow">
        <label>{localInstance.startup_condition_subtype}:</label>
        <select
          value={config.subType}
          onChange={(e) =>
            onChange({ ...config, subType: e.target.value as FileConditionSubType })
          }
        >
          {availableSubTypes.map((st) => (
            <option key={st.value} value={st.value}>
              {st.label}
            </option>
          ))}
        </select>
      </div>

      {/* 文件状态检查选项 */}
      {config.subType === FileConditionSubType.FileStatus && isSpecificFile && (
        <div className="form--StartupConditionConfigRow">
          <label>{localInstance.startup_condition_file_status_options}:</label>
          <div className="form--FileStatusCheckOptions">
            <label className="form--CheckboxLabel">
              <input
                type="checkbox"
                checked={(config.fileStatusChecks || []).includes(FileStatusCheckType.IsOpen)}
                onChange={(e) => handleFileStatusCheckChange(FileStatusCheckType.IsOpen, e.target.checked)}
              />
              {localInstance.startup_condition_file_is_open}
            </label>
            <label className="form--CheckboxLabel">
              <input
                type="checkbox"
                checked={(config.fileStatusChecks || []).includes(FileStatusCheckType.IsActive)}
                onChange={(e) => handleFileStatusCheckChange(FileStatusCheckType.IsActive, e.target.checked)}
              />
              {localInstance.startup_condition_file_is_active}
            </label>
          </div>
        </div>
      )}

      {/* 内容包含检查 */}
      {config.subType === FileConditionSubType.ContentContains && (
        <div className="form--StartupConditionConfigRow">
          <label>{localInstance.startup_condition_search_text}:</label>
          <VariableReferenceInput
            placeholder={localInstance.startup_condition_search_text_placeholder}
            value={config.searchText || ""}
            onChange={(value) => onChange({ ...config, searchText: value })}
            formConfig={formConfig}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
      )}

      {/* 属性检查 - 多属性支持 */}
      {config.subType === FileConditionSubType.FrontmatterProperty && (
        <div className="form--StartupConditionPropertyConfig">
          <div className="form--StartupConditionConfigRow">
            <label>{localInstance.startup_condition_properties}:</label>
          </div>
          
          {/* 显示属性列表 */}
          {(config.properties && config.properties.length > 0) ? (
            <div className="form--PropertyList">
              {config.properties.map((prop, index) => (
                <div key={index} className="form--PropertyItem">
                  <VariableReferenceInput
                    placeholder={localInstance.property_name}
                    value={prop.name}
                    onChange={(value) => handleUpdateProperty(index, { name: value })}
                    formConfig={formConfig}
                    style={{ width: 100 }}
                  />
                  <select
                    value={prop.operator}
                    onChange={(e) => handleUpdateProperty(index, { operator: e.target.value as ConditionOperator })}
                  >
                    <option value={ConditionOperator.Equals}>{localInstance.equal}</option>
                    <option value={ConditionOperator.NotEquals}>{localInstance.not_equal}</option>
                    <option value={ConditionOperator.Contains}>{localInstance.contains}</option>
                  </select>
                  <VariableReferenceInput
                    placeholder={localInstance.property_value}
                    value={prop.value}
                    onChange={(value) => handleUpdateProperty(index, { value: value })}
                    formConfig={formConfig}
                    style={{ width: 100 }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveProperty(index)}
                    className="form--PropertyRemoveButton"
                    title={localInstance.delete}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            // 向后兼容：显示旧的单属性配置
            config.propertyName && (
              <div className="form--PropertyItem">
                <VariableReferenceInput
                  placeholder={localInstance.property_name}
                  value={config.propertyName || ""}
                  onChange={(value) => onChange({ ...config, propertyName: value })}
                  formConfig={formConfig}
                  style={{ width: 100 }}
                />
                <select
                  value={config.operator || ConditionOperator.Equals}
                  onChange={(e) => onChange({ ...config, operator: e.target.value as ConditionOperator })}
                >
                  <option value={ConditionOperator.Equals}>{localInstance.equal}</option>
                  <option value={ConditionOperator.NotEquals}>{localInstance.not_equal}</option>
                  <option value={ConditionOperator.Contains}>{localInstance.contains}</option>
                </select>
                <VariableReferenceInput
                  placeholder={localInstance.property_value}
                  value={config.propertyValue || ""}
                  onChange={(value) => onChange({ ...config, propertyValue: value })}
                  formConfig={formConfig}
                  style={{ width: 100 }}
                />
              </div>
            )
          )}
          
          {/* 添加属性按钮 */}
          <button
            type="button"
            onClick={handleAddProperty}
            className="form--AddPropertyButton"
          >
            <Plus size={14} />
            {localInstance.startup_condition_add_property}
          </button>
        </div>
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
