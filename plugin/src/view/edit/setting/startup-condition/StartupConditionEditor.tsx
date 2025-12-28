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
  Variable,
  MoreHorizontal,
  Undo,
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
  FileCheckType,
  FileTargetMode,
  FileStatusCheckType,
  SystemConditionSubType,
  ConditionOperator,
  createEmptyStartupConditionsConfig,
} from "src/model/startup-condition/StartupCondition";
import type {
  TimeConditionConfig,
  FileConditionConfig,
  PropertyCheckConfig,
  SystemConditionConfig,
  ScriptConditionConfig,
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
import { Select2 } from "src/component/select2/Select";
import { DropdownMenu as RadixDropdownMenu } from "radix-ui";
import { VariableReferenceInput } from "src/component/input/VariableReferenceInput";

/**
 * 统一的条件子类型枚举（扁平化所有子类型）
 */
export enum UnifiedConditionSubType {
  // 时间类
  TimeRange = "time_range",
  DayOfWeek = "day_of_week",
  DateRange = "date_range",
  LastExecutionInterval = "last_execution_interval",
  // 文件类
  FileExists = "file_exists",
  FileStatus = "file_status",
  ContentContains = "content_contains",
  FrontmatterProperty = "frontmatter_property",
  // 系统类
  PluginVersion = "plugin_version",
  ObsidianVersion = "obsidian_version",
  WorkspaceLayout = "workspace_layout",
  // 脚本类
  ScriptExpression = "script_expression",
}

/**
 * 从统一子类型获取原始条件类型
 */
function getConditionTypeFromSubType(subType: UnifiedConditionSubType): StartupConditionType {
  switch (subType) {
    case UnifiedConditionSubType.TimeRange:
    case UnifiedConditionSubType.DayOfWeek:
    case UnifiedConditionSubType.DateRange:
    case UnifiedConditionSubType.LastExecutionInterval:
      return StartupConditionType.Time;
    case UnifiedConditionSubType.FileExists:
    case UnifiedConditionSubType.FileStatus:
    case UnifiedConditionSubType.ContentContains:
    case UnifiedConditionSubType.FrontmatterProperty:
      return StartupConditionType.File;
    case UnifiedConditionSubType.PluginVersion:
    case UnifiedConditionSubType.ObsidianVersion:
    case UnifiedConditionSubType.WorkspaceLayout:
      return StartupConditionType.System;
    case UnifiedConditionSubType.ScriptExpression:
      return StartupConditionType.Script;
  }
}

/**
 * 从原始条件获取统一子类型
 */
function getUnifiedSubType(condition: StartupCondition): UnifiedConditionSubType {
  switch (condition.type) {
    case StartupConditionType.Time: {
      const config = condition.config as TimeConditionConfig;
      switch (config?.subType) {
        case TimeConditionSubType.TimeRange:
          return UnifiedConditionSubType.TimeRange;
        case TimeConditionSubType.DayOfWeek:
          return UnifiedConditionSubType.DayOfWeek;
        case TimeConditionSubType.DateRange:
          return UnifiedConditionSubType.DateRange;
        case TimeConditionSubType.LastExecutionInterval:
          return UnifiedConditionSubType.LastExecutionInterval;
        default:
          return UnifiedConditionSubType.TimeRange;
      }
    }
    case StartupConditionType.File: {
      const config = condition.config as FileConditionConfig;
      switch (config?.subType) {
        case FileConditionSubType.FileExists:
          return UnifiedConditionSubType.FileExists;
        case FileConditionSubType.FileStatus:
          return UnifiedConditionSubType.FileStatus;
        case FileConditionSubType.ContentContains:
          return UnifiedConditionSubType.ContentContains;
        case FileConditionSubType.FrontmatterProperty:
          return UnifiedConditionSubType.FrontmatterProperty;
        default:
          return UnifiedConditionSubType.ContentContains;
      }
    }
    case StartupConditionType.System: {
      const config = condition.config as SystemConditionConfig;
      switch (config?.subType) {
        case SystemConditionSubType.PluginVersion:
          return UnifiedConditionSubType.PluginVersion;
        case SystemConditionSubType.ObsidianVersion:
          return UnifiedConditionSubType.ObsidianVersion;
        case SystemConditionSubType.WorkspaceLayout:
          return UnifiedConditionSubType.WorkspaceLayout;
        default:
          return UnifiedConditionSubType.PluginVersion;
      }
    }
    case StartupConditionType.Script:
      return UnifiedConditionSubType.ScriptExpression;
    default:
      return UnifiedConditionSubType.TimeRange;
  }
}

/**
 * 获取所有子类型选项
 */
function getAllSubTypeOptions() {
  return [
    // 时间类
    {
      value: UnifiedConditionSubType.TimeRange,
      label: localInstance.startup_condition_time_range,
      icon: <Clock size={14} />,
      group: localInstance.startup_condition_type_time,
    },
    {
      value: UnifiedConditionSubType.DayOfWeek,
      label: localInstance.startup_condition_day_of_week,
      icon: <Clock size={14} />,
      group: localInstance.startup_condition_type_time,
    },
    {
      value: UnifiedConditionSubType.DateRange,
      label: localInstance.startup_condition_date_range,
      icon: <Clock size={14} />,
      group: localInstance.startup_condition_type_time,
    },
    {
      value: UnifiedConditionSubType.LastExecutionInterval,
      label: localInstance.startup_condition_interval,
      icon: <Clock size={14} />,
      group: localInstance.startup_condition_type_time,
    },
    // 文件类
    {
      value: UnifiedConditionSubType.FileExists,
      label: localInstance.startup_condition_file_exists,
      icon: <File size={14} />,
      group: localInstance.startup_condition_type_file,
    },
    {
      value: UnifiedConditionSubType.FileStatus,
      label: localInstance.startup_condition_file_status,
      icon: <File size={14} />,
      group: localInstance.startup_condition_type_file,
    },
    {
      value: UnifiedConditionSubType.ContentContains,
      label: localInstance.startup_condition_content_contains,
      icon: <File size={14} />,
      group: localInstance.startup_condition_type_file,
    },
    {
      value: UnifiedConditionSubType.FrontmatterProperty,
      label: localInstance.startup_condition_frontmatter,
      icon: <File size={14} />,
      group: localInstance.startup_condition_type_file,
    },
    // 系统类
    {
      value: UnifiedConditionSubType.PluginVersion,
      label: localInstance.startup_condition_plugin_version,
      icon: <Settings size={14} />,
      group: localInstance.startup_condition_type_system,
    },
    {
      value: UnifiedConditionSubType.ObsidianVersion,
      label: localInstance.startup_condition_obsidian_version,
      icon: <Settings size={14} />,
      group: localInstance.startup_condition_type_system,
    },
    {
      value: UnifiedConditionSubType.WorkspaceLayout,
      label: localInstance.startup_condition_workspace_layout,
      icon: <Settings size={14} />,
      group: localInstance.startup_condition_type_system,
    },
    // 脚本类
    {
      value: UnifiedConditionSubType.ScriptExpression,
      label: localInstance.startup_condition_script_expression,
      icon: <Code size={14} />,
      group: localInstance.startup_condition_type_script,
    },
  ];
}

/**
 * 创建新条件
 */
function createNewCondition(subType: UnifiedConditionSubType): StartupCondition {
  const type = getConditionTypeFromSubType(subType);
  const config = getDefaultConfigForSubType(subType);
  return {
    id: v4(),
    type,
    relation: ConditionRelation.And,
    enabled: true,
    config,
  };
}

/**
 * 根据子类型获取默认配置
 */
function getDefaultConfigForSubType(
  subType: UnifiedConditionSubType
): TimeConditionConfig | FileConditionConfig | SystemConditionConfig | ScriptConditionConfig {
  switch (subType) {
    case UnifiedConditionSubType.TimeRange:
      return {
        subType: TimeConditionSubType.TimeRange,
        startTime: "09:00",
        endTime: "18:00",
      };
    case UnifiedConditionSubType.DayOfWeek:
      return {
        subType: TimeConditionSubType.DayOfWeek,
        daysOfWeek: [1, 2, 3, 4, 5],
      };
    case UnifiedConditionSubType.DateRange:
      return {
        subType: TimeConditionSubType.DateRange,
        startDate: "",
        endDate: "",
      };
    case UnifiedConditionSubType.LastExecutionInterval:
      return {
        subType: TimeConditionSubType.LastExecutionInterval,
        intervalMinutes: 60,
      };
    case UnifiedConditionSubType.FileExists:
      return {
        subType: FileConditionSubType.FileExists,
        checkType: FileCheckType.File,
        targetMode: FileTargetMode.SpecificFile,
        targetFilePath: "",
        operator: ConditionOperator.Equals,
      };
    case UnifiedConditionSubType.FileStatus:
      return {
        subType: FileConditionSubType.FileStatus,
        targetMode: FileTargetMode.SpecificFile,
        targetFilePath: "",
        fileStatusChecks: [FileStatusCheckType.IsOpen],
      };
    case UnifiedConditionSubType.ContentContains:
      return {
        subType: FileConditionSubType.ContentContains,
        targetMode: FileTargetMode.CurrentFile,
        searchText: "",
      };
    case UnifiedConditionSubType.FrontmatterProperty:
      return {
        subType: FileConditionSubType.FrontmatterProperty,
        targetMode: FileTargetMode.CurrentFile,
        properties: [],
        operator: ConditionOperator.Equals,
      };
    case UnifiedConditionSubType.PluginVersion:
      return {
        subType: SystemConditionSubType.PluginVersion,
        operator: ConditionOperator.GreaterThanOrEqual,
        version: "",
      };
    case UnifiedConditionSubType.ObsidianVersion:
      return {
        subType: SystemConditionSubType.ObsidianVersion,
        operator: ConditionOperator.GreaterThanOrEqual,
        version: "",
      };
    case UnifiedConditionSubType.WorkspaceLayout:
      return {
        subType: SystemConditionSubType.WorkspaceLayout,
        layoutType: "",
      };
    case UnifiedConditionSubType.ScriptExpression:
      return {
        expression: "return true;",
      };
  }
}

/**
 * 创建条件组
 */
function createNewConditionGroup(): StartupCondition {
  return {
    id: v4(),
    type: "group",
    relation: ConditionRelation.And,
    enabled: true,
    conditions: [],
  };
}

/**
 * 获取时间范围条件的操作符选项
 */
function getTimeRangeOperatorOptions() {
  return [
    { label: localInstance.condition_in_range || "在范围内", value: ConditionOperator.Between },
    { label: localInstance.condition_not_in_range || "不在范围内", value: ConditionOperator.NotIn },
    { label: localInstance.time_before || "早于开始时间", value: ConditionOperator.LessThan },
    { label: localInstance.time_before_or_equal || "早于或等于开始时间", value: ConditionOperator.LessThanOrEqual },
    { label: localInstance.time_after || "晚于结束时间", value: ConditionOperator.GreaterThan },
    { label: localInstance.time_after_or_equal || "晚于或等于结束时间", value: ConditionOperator.GreaterThanOrEqual },
  ];
}

/**
 * 获取星期几条件的操作符选项
 */
function getDayOfWeekOperatorOptions() {
  return [
    { label: localInstance.condition_in_list || "在列表中", value: ConditionOperator.In },
    { label: localInstance.condition_not_in_list || "不在列表中", value: ConditionOperator.NotIn },
    { label: localInstance.condition_in_range || "在范围内", value: ConditionOperator.Between },
    { label: localInstance.condition_not_in_range || "不在范围内", value: ConditionOperator.NotContains },
  ];
}

/**
 * 获取日期范围条件的操作符选项
 */
function getDateRangeOperatorOptions() {
  return [
    { label: localInstance.condition_in_range || "在范围内", value: ConditionOperator.Between },
    { label: localInstance.condition_not_in_range || "不在范围内", value: ConditionOperator.NotIn },
    { label: localInstance.time_before || "早于开始日期", value: ConditionOperator.LessThan },
    { label: localInstance.time_before_or_equal || "早于或等于开始日期", value: ConditionOperator.LessThanOrEqual },
    { label: localInstance.time_after || "晚于结束日期", value: ConditionOperator.GreaterThan },
    { label: localInstance.time_after_or_equal || "晚于或等于结束日期", value: ConditionOperator.GreaterThanOrEqual },
  ];
}

/**
 * 获取文件存在性条件的操作符选项
 */
function getFileExistsOperatorOptions() {
  return [
    { label: localInstance.condition_file_exists || "文件存在", value: ConditionOperator.Equals },
    { label: localInstance.condition_file_not_exists || "文件不存在", value: ConditionOperator.NotEquals },
  ];
}

/**
 * 获取文件状态条件的操作符选项
 */
function getFileStatusOperatorOptions() {
  return [
    { label: localInstance.condition_status_match || "状态满足", value: ConditionOperator.Equals },
    { label: localInstance.condition_status_not_match || "状态不满足", value: ConditionOperator.NotEquals },
  ];
}

/**
 * 获取内容包含条件的操作符选项
 */
function getContentContainsOperatorOptions() {
  return [
    { label: localInstance.contains, value: ConditionOperator.Contains },
    { label: localInstance.not_contains, value: ConditionOperator.NotContains },
  ];
}



interface StartupConditionEditorProps {
  config: StartupConditionsConfig | undefined;
  onChange: (config: StartupConditionsConfig) => void;
  formFilePath?: string;
  formConfig?: FormConfig;
}

/**
 * 启动条件编辑器组件 - 统一界面版本
 */
export function StartupConditionEditor(props: StartupConditionEditorProps) {
  const { config, onChange, formFilePath, formConfig } = props;
  const app = useObsidianApp();
  const [testResult, setTestResult] = useState<ConditionEvaluationResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [undo, setUndo] = useState<StartupConditionsConfig | null>(null);

  const currentConfig = config || createEmptyStartupConditionsConfig();

  const handleToggleEnabled = useCallback(() => {
    onChange({
      ...currentConfig,
      enabled: !currentConfig.enabled,
    });
  }, [currentConfig, onChange]);

  const handleAddCondition = useCallback(
    (subType: UnifiedConditionSubType) => {
      const newCondition = createNewCondition(subType);
      onChange({
        ...currentConfig,
        enabled: true,
        conditions: [...currentConfig.conditions, newCondition],
      });
    },
    [currentConfig, onChange]
  );

  const handleAddGroup = useCallback(() => {
    const newGroup = createNewConditionGroup();
    onChange({
      ...currentConfig,
      enabled: true,
      conditions: [...currentConfig.conditions, newGroup],
    });
  }, [currentConfig, onChange]);

  const handleRemoveCondition = useCallback(
    (id: string) => {
      onChange({
        ...currentConfig,
        conditions: currentConfig.conditions.filter((c) => c.id !== id),
      });
    },
    [currentConfig, onChange]
  );

  const handleDuplicateCondition = useCallback(
    (id: string) => {
      const condition = currentConfig.conditions.find((c) => c.id === id);
      if (condition) {
        const newCondition = JSON.parse(JSON.stringify(condition));
        newCondition.id = v4();
        onChange({
          ...currentConfig,
          conditions: [...currentConfig.conditions, newCondition],
        });
      }
    },
    [currentConfig, onChange]
  );

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

  const handleRelationChange = useCallback(
    (relation: ConditionRelation) => {
      onChange({
        ...currentConfig,
        relation,
      });
    },
    [currentConfig, onChange]
  );

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

  const handleClearConditions = useCallback(() => {
    if (currentConfig.conditions && currentConfig.conditions.length > 0) {
      setUndo(currentConfig);
    }
    onChange({
      ...currentConfig,
      conditions: [],
    });
  }, [currentConfig, onChange]);

  const handleUndo = useCallback(() => {
    if (undo) {
      onChange(undo);
      setUndo(null);
    }
  }, [undo, onChange]);

  return (
    <div className="form--StartupConditionEditor">
      {/* 启用开关 */}
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
        <span className="form--StartupConditionStatusText">
          {currentConfig.enabled ? localInstance.enabled : localInstance.disabled}
        </span>

        {currentConfig.enabled && (
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <button
              className="form--StartupConditionTestButton"
              onClick={handleTestConditions}
              disabled={isTesting}
              title={localInstance.test_condition}
              style={{ padding: "4px 8px", height: "28px", fontSize: "12px" }}
            >
              <Play size={14} />
              {isTesting ? localInstance.testing : localInstance.test_condition}
            </button>

            <button
              className="form--ClearFilterButton"
              data-type="danger"
              onClick={handleClearConditions}
              title={localInstance.clear_condition}
              style={{ padding: "4px 8px", height: "28px" }}
            >
              <Trash2 size={14} />
            </button>
            {undo && (
              <button
                className="form--UndoClearFilterButton"
                data-type="primary"
                onClick={handleUndo}
                title={localInstance.undo}
                style={{ padding: "4px 8px", height: "28px" }}
              >
                <Undo size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {currentConfig.enabled && (
        <>
          {/* 条件列表 - 使用 FilterRoot 样式 */}
          <div className="form--FilterRoot">
            <div className="form--FilterRootContent">
              {currentConfig.conditions.map((condition, index) => (
                <UnifiedConditionItem
                  key={condition.id}
                  condition={condition}
                  index={index}
                  relation={currentConfig.relation}
                  formConfig={formConfig}
                  onUpdate={(updates) => handleUpdateCondition(condition.id, updates)}
                  onRemove={() => handleRemoveCondition(condition.id)}
                  onDuplicate={() => handleDuplicateCondition(condition.id)}
                  onRelationChange={handleRelationChange}
                />
              ))}

              {/* 添加条件按钮 */}
              <div className="form--FilterRootAdd">
                <StartupConditionAddDropdown
                  onAddCondition={handleAddCondition}
                  onAddGroup={handleAddGroup}
                />
              </div>
            </div>
          </div>

          {/* 测试结果 */}
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
        </>
      )}
    </div>
  );
}

/**
 * 添加条件下拉菜单
 */
function StartupConditionAddDropdown(props: {
  onAddCondition: (subType: UnifiedConditionSubType) => void;
  onAddGroup: () => void;
}) {
  const { onAddCondition, onAddGroup } = props;
  const [open, setOpen] = useState(false);
  const allSubTypes = getAllSubTypeOptions();

  const groupedOptions = useMemo(() => {
    const groups: Record<string, typeof allSubTypes> = {};
    allSubTypes.forEach((opt) => {
      if (!groups[opt.group]) {
        groups[opt.group] = [];
      }
      groups[opt.group].push(opt);
    });
    return groups;
  }, []);

  return (
    <RadixDropdownMenu.Root onOpenChange={setOpen} open={open}>
      <RadixDropdownMenu.Trigger asChild>
        <button className="form--TextButton">
          <Plus size={16} /> {localInstance.add_condition}
          <ChevronDown size={16} />
        </button>
      </RadixDropdownMenu.Trigger>
      {open && (
        <RadixDropdownMenu.Portal container={window.activeDocument.body}>
          <RadixDropdownMenu.Content
            className="form--FilterDropdownMenuContent form--StartupConditionAddMenu"
            sideOffset={5}
            collisionPadding={8}
            align="start"
            side="bottom"
          >
            {Object.entries(groupedOptions).map(([groupName, options]) => (
              <div key={groupName}>
                <div className="form--StartupConditionAddMenuGroup">
                  {groupName}
                </div>
                {options.map((opt) => (
                  <RadixDropdownMenu.Item
                    key={opt.value}
                    className="form--FilterDropdownMenuItem"
                    onClick={() => {
                      onAddCondition(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span className="form--FilterDropdownMenuItemIcon">
                      {opt.icon}
                    </span>
                    {opt.label}
                  </RadixDropdownMenu.Item>
                ))}
              </div>
            ))}
            <div className="form--StartupConditionAddMenuDivider" />
            <RadixDropdownMenu.Item
              className="form--FilterDropdownMenuItem"
              onClick={() => {
                onAddGroup();
                setOpen(false);
              }}
            >
              <span className="form--FilterDropdownMenuItemIcon">
                <CopyPlus size={16} />
              </span>
              {localInstance.add_condition_group}
            </RadixDropdownMenu.Item>
            <RadixDropdownMenu.Arrow className="form--FilterDropdownMenuArrow" />
          </RadixDropdownMenu.Content>
        </RadixDropdownMenu.Portal>
      )}
    </RadixDropdownMenu.Root>
  );
}

/**
 * 统一条件项组件 - 类似 FilterItem
 */
function UnifiedConditionItem(props: {
  condition: StartupCondition;
  index: number;
  relation: ConditionRelation;
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onRelationChange: (relation: ConditionRelation) => void;
}) {
  const { condition, index, relation, formConfig, onUpdate, onRemove, onDuplicate, onRelationChange } = props;

  const relationEl = useMemo(() => {
    if (index === 0) {
      return localInstance.operator_condition;
    }

    if (index === 1) {
      return (
        <Select2
          value={relation}
          onChange={(value) => onRelationChange(value as ConditionRelation)}
          options={[
            { label: localInstance.operator_and, value: ConditionRelation.And },
            { label: localInstance.operator_or, value: ConditionRelation.Or },
          ]}
        />
      );
    } else {
      return relation === ConditionRelation.And
        ? localInstance.operator_and
        : localInstance.operator_or;
    }
  }, [index, relation, onRelationChange]);

  // 判断是否为脚本类型条件
  const isScriptCondition = condition.type === StartupConditionType.Script;

  return (
    <div className={`form--Filter ${isScriptCondition ? "form--FilterScript" : ""}`}>
      <div className="form--FilterRelation">{relationEl}</div>
      <div className="form--FilterContent">
        {condition.type === "group" ? (
          <UnifiedConditionGroup
            condition={condition}
            formConfig={formConfig}
            onUpdate={onUpdate}
          />
        ) : (
          <UnifiedConditionRule
            condition={condition}
            formConfig={formConfig}
            onUpdate={onUpdate}
          />
        )}
      </div>
      <div className="form--FilterMenu">
        <ConditionMenuDropdown
          onDelete={onRemove}
          onDuplicate={onDuplicate}
        />
      </div>
    </div>
  );
}

/**
 * 条件菜单下拉
 */
function ConditionMenuDropdown(props: {
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { onDelete, onDuplicate } = props;
  const [open, setOpen] = useState(false);

  return (
    <RadixDropdownMenu.Root onOpenChange={setOpen} open={open}>
      <RadixDropdownMenu.Trigger asChild>
        <button className="form--TextButton">
          <MoreHorizontal size={16} />
        </button>
      </RadixDropdownMenu.Trigger>
      {open && (
        <RadixDropdownMenu.Portal container={window.activeDocument.body}>
          <RadixDropdownMenu.Content
            className="form--FilterDropdownMenuContent"
            sideOffset={5}
            collisionPadding={8}
            align="end"
            side="bottom"
          >
            <RadixDropdownMenu.Item
              className="form--FilterDropdownMenuItem"
              onClick={() => {
                onDuplicate();
                setOpen(false);
              }}
            >
              <span className="form--FilterDropdownMenuItemIcon">
                <Copy size={16} />
              </span>
              {localInstance.duplicate}
            </RadixDropdownMenu.Item>
            <RadixDropdownMenu.Item
              className="form--FilterDropdownMenuItem"
              onClick={() => {
                onDelete();
                setOpen(false);
              }}
            >
              <span className="form--FilterDropdownMenuItemIcon">
                <Trash2 size={16} />
              </span>
              {localInstance.delete}
            </RadixDropdownMenu.Item>
            <RadixDropdownMenu.Arrow className="form--FilterDropdownMenuArrow" />
          </RadixDropdownMenu.Content>
        </RadixDropdownMenu.Portal>
      )}
    </RadixDropdownMenu.Root>
  );
}

/**
 * 统一条件规则组件
 */
function UnifiedConditionRule(props: {
  condition: StartupCondition;
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, formConfig, onUpdate } = props;
  const currentSubType = getUnifiedSubType(condition);
  const allSubTypes = getAllSubTypeOptions();

  const handleSubTypeChange = (newSubType: UnifiedConditionSubType) => {
    const newType = getConditionTypeFromSubType(newSubType);
    const newConfig = getDefaultConfigForSubType(newSubType);
    onUpdate({
      type: newType,
      config: newConfig,
    });
  };

  const isScript = currentSubType === UnifiedConditionSubType.ScriptExpression;

  return (
    <div className={`form--FilterRule form--StartupConditionRule ${isScript ? "form--StartupConditionRuleScript" : ""}`}>
      {/* 比较对象下拉 - 包含所有子类型 */}
      <Select2
        value={currentSubType}
        onChange={(value) => handleSubTypeChange(value as UnifiedConditionSubType)}
        options={allSubTypes.map((opt) => ({
          label: opt.label,
          value: opt.value,
        }))}
      />

      {/* 根据子类型动态渲染比较符和比较值 */}
      <ConditionValueEditor
        condition={condition}
        subType={currentSubType}
        formConfig={formConfig}
        onUpdate={onUpdate}
      />
    </div>
  );
}

/**
 * 条件值编辑器 - 根据子类型动态渲染
 */
function ConditionValueEditor(props: {
  condition: StartupCondition;
  subType: UnifiedConditionSubType;
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, subType, formConfig, onUpdate } = props;

  const updateConfig = <T extends object>(updates: Partial<T>) => {
    onUpdate({
      config: { ...condition.config, ...updates } as any,
    });
  };

  // 时间范围
  if (subType === UnifiedConditionSubType.TimeRange) {
    const config = condition.config as TimeConditionConfig;
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.Between}
          onChange={(value) => updateConfig<TimeConditionConfig>({ operator: value as ConditionOperator })}
          options={getTimeRangeOperatorOptions()}
        />
        <input
          type="time"
          className="form--ConditionInput"
          value={config.startTime || "09:00"}
          onChange={(e) => updateConfig<TimeConditionConfig>({ startTime: e.target.value })}
        />
        <span className="form--ConditionOperatorLabel">{localInstance.and_text || "至"}</span>
        <input
          type="time"
          className="form--ConditionInput"
          value={config.endTime || "18:00"}
          onChange={(e) => updateConfig<TimeConditionConfig>({ endTime: e.target.value })}
        />
      </>
    );
  }

  // 星期几
  if (subType === UnifiedConditionSubType.DayOfWeek) {
    const config = condition.config as TimeConditionConfig;
    const dayShortNames = [0, 1, 2, 3, 4, 5, 6].map(i => week(i, 'short'));
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.In}
          onChange={(value) => updateConfig<TimeConditionConfig>({ operator: value as ConditionOperator })}
          options={getDayOfWeekOperatorOptions()}
        />
        <div className="form--DayOfWeekPicker">
          {dayShortNames.map((name, index) => (
            <button
              key={index}
              type="button"
              className={(config.daysOfWeek || []).includes(index) ? "selected" : ""}
              title={week(index, 'full')}
              onClick={() => {
                const days = config.daysOfWeek || [];
                const newDays = days.includes(index)
                  ? days.filter((d) => d !== index)
                  : [...days, index];
                updateConfig<TimeConditionConfig>({ daysOfWeek: newDays });
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </>
    );
  }

  // 日期范围
  if (subType === UnifiedConditionSubType.DateRange) {
    const config = condition.config as TimeConditionConfig;
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.Between}
          onChange={(value) => updateConfig<TimeConditionConfig>({ operator: value as ConditionOperator })}
          options={getDateRangeOperatorOptions()}
        />
        <input
          type="date"
          className="form--ConditionInput"
          value={config.startDate || ""}
          onChange={(e) => updateConfig<TimeConditionConfig>({ startDate: e.target.value })}
        />
        <span className="form--ConditionOperatorLabel">{localInstance.and_text || "至"}</span>
        <input
          type="date"
          className="form--ConditionInput"
          value={config.endDate || ""}
          onChange={(e) => updateConfig<TimeConditionConfig>({ endDate: e.target.value })}
        />
      </>
    );
  }

  // 执行间隔
  if (subType === UnifiedConditionSubType.LastExecutionInterval) {
    const config = condition.config as TimeConditionConfig;
    return (
      <>
        <span className="form--ConditionOperatorLabel">{localInstance.greater_than_or_equal || ">="}</span>
        <input
          type="number"
          className="form--ConditionInput form--ConditionInputNumber"
          min="1"
          value={config.intervalMinutes || 60}
          onChange={(e) =>
            updateConfig<TimeConditionConfig>({ intervalMinutes: parseInt(e.target.value, 10) || 60 })
          }
        />
        <span className="form--ConditionOperatorLabel">{localInstance.minutes}</span>
      </>
    );
  }

  // 文件存在
  if (subType === UnifiedConditionSubType.FileExists) {
    const config = condition.config as FileConditionConfig;
    return (
      <>
        <Select2
          value={config.checkType || FileCheckType.File}
          onChange={(value) => updateConfig<FileConditionConfig>({ checkType: value as FileCheckType })}
          options={[
            { label: "文件存在", value: FileCheckType.File },
            { label: "文件夹存在", value: FileCheckType.Folder },
            { label: "文件夹包含文件", value: FileCheckType.FolderHasFiles },
          ]}
        />
        <VariableReferenceInput
          value={config.targetFilePath || ""}
          onChange={(value) => updateConfig<FileConditionConfig>({ targetFilePath: value })}
          placeholder={localInstance.startup_condition_file_path_placeholder}
          formConfig={formConfig}
          enableFileSearch={true}
          className="form--ConditionInputFlex"
        />
        <Select2
          value={config.operator || ConditionOperator.Equals}
          onChange={(value) => updateConfig<FileConditionConfig>({ operator: value as ConditionOperator })}
          options={getFileExistsOperatorOptions()}
        />
      </>
    );
  }

  // 文件状态
  if (subType === UnifiedConditionSubType.FileStatus) {
    const config = condition.config as FileConditionConfig;
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.Equals}
          onChange={(value) => updateConfig<FileConditionConfig>({ operator: value as ConditionOperator })}
          options={getFileStatusOperatorOptions()}
        />
        <VariableReferenceInput
          value={config.targetFilePath || ""}
          onChange={(value) => updateConfig<FileConditionConfig>({ targetFilePath: value })}
          placeholder={localInstance.startup_condition_file_path_placeholder}
          formConfig={formConfig}
          enableFileSearch={true}
          className="form--ConditionInputFlex"
        />
        <div className="form--FileStatusCheckOptions">
          <label className="form--CheckboxLabel">
            <input
              type="checkbox"
              checked={(config.fileStatusChecks || []).includes(FileStatusCheckType.IsOpen)}
              onChange={(e) => {
                const currentChecks = config.fileStatusChecks || [];
                const newChecks = e.target.checked
                  ? [...currentChecks, FileStatusCheckType.IsOpen]
                  : currentChecks.filter((c) => c !== FileStatusCheckType.IsOpen);
                updateConfig<FileConditionConfig>({ fileStatusChecks: newChecks });
              }}
            />
            {localInstance.startup_condition_file_is_open}
          </label>
          <label className="form--CheckboxLabel">
            <input
              type="checkbox"
              checked={(config.fileStatusChecks || []).includes(FileStatusCheckType.IsActive)}
              onChange={(e) => {
                const currentChecks = config.fileStatusChecks || [];
                const newChecks = e.target.checked
                  ? [...currentChecks, FileStatusCheckType.IsActive]
                  : currentChecks.filter((c) => c !== FileStatusCheckType.IsActive);
                updateConfig<FileConditionConfig>({ fileStatusChecks: newChecks });
              }}
            />
            {localInstance.startup_condition_file_is_active}
          </label>
        </div>
      </>
    );
  }

  // 内容包含
  if (subType === UnifiedConditionSubType.ContentContains) {
    const config = condition.config as FileConditionConfig;
    return (
      <>
        <Select2
          value={config.targetMode || FileTargetMode.CurrentFile}
          onChange={(value) => updateConfig<FileConditionConfig>({ targetMode: value as FileTargetMode })}
          options={[
            { label: localInstance.startup_condition_current_file, value: FileTargetMode.CurrentFile },
            { label: localInstance.startup_condition_specific_file, value: FileTargetMode.SpecificFile },
          ]}
        />
        {config.targetMode === FileTargetMode.SpecificFile && (
          <VariableReferenceInput
            value={config.targetFilePath || ""}
            onChange={(value) => updateConfig<FileConditionConfig>({ targetFilePath: value })}
            placeholder={localInstance.startup_condition_file_path_placeholder}
            formConfig={formConfig}
            enableFileSearch={true}
            className="form--ConditionInputFlex"
          />
        )}
        <Select2
          value={config.operator || ConditionOperator.Contains}
          onChange={(value) => updateConfig<FileConditionConfig>({ operator: value as ConditionOperator })}
          options={getContentContainsOperatorOptions()}
        />
        <VariableReferenceInput
          value={config.searchText || ""}
          onChange={(value) => updateConfig<FileConditionConfig>({ searchText: value })}
          placeholder={localInstance.startup_condition_search_text_placeholder}
          formConfig={formConfig}
          className="form--ConditionInputFlex"
        />
      </>
    );
  }

  // 属性检查
  if (subType === UnifiedConditionSubType.FrontmatterProperty) {
    const config = condition.config as FileConditionConfig;
    return (
      <FrontmatterPropertyEditor
        config={config}
        formConfig={formConfig}
        onChange={(updates) => updateConfig<FileConditionConfig>(updates)}
      />
    );
  }

  // 插件版本
  if (subType === UnifiedConditionSubType.PluginVersion) {
    const config = condition.config as SystemConditionConfig;
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.GreaterThanOrEqual}
          onChange={(value) => updateConfig<SystemConditionConfig>({ operator: value as ConditionOperator })}
          options={[
            { label: localInstance.equal, value: ConditionOperator.Equals },
            { label: localInstance.greater_than, value: ConditionOperator.GreaterThan },
            { label: localInstance.greater_than_or_equal, value: ConditionOperator.GreaterThanOrEqual },
            { label: localInstance.less_than, value: ConditionOperator.LessThan },
            { label: localInstance.less_than_or_equal, value: ConditionOperator.LessThanOrEqual },
          ]}
        />
        <input
          type="text"
          className="form--ConditionInput"
          placeholder="1.0.0"
          value={config.version || ""}
          onChange={(e) => updateConfig<SystemConditionConfig>({ version: e.target.value })}
        />
      </>
    );
  }

  // Obsidian 版本
  if (subType === UnifiedConditionSubType.ObsidianVersion) {
    const config = condition.config as SystemConditionConfig;
    return (
      <>
        <Select2
          value={config.operator || ConditionOperator.GreaterThanOrEqual}
          onChange={(value) => updateConfig<SystemConditionConfig>({ operator: value as ConditionOperator })}
          options={[
            { label: localInstance.equal, value: ConditionOperator.Equals },
            { label: localInstance.greater_than, value: ConditionOperator.GreaterThan },
            { label: localInstance.greater_than_or_equal, value: ConditionOperator.GreaterThanOrEqual },
            { label: localInstance.less_than, value: ConditionOperator.LessThan },
            { label: localInstance.less_than_or_equal, value: ConditionOperator.LessThanOrEqual },
          ]}
        />
        <input
          type="text"
          className="form--ConditionInput"
          placeholder="1.0.0"
          value={config.version || ""}
          onChange={(e) => updateConfig<SystemConditionConfig>({ version: e.target.value })}
        />
      </>
    );
  }

  // 工作区布局
  if (subType === UnifiedConditionSubType.WorkspaceLayout) {
    const config = condition.config as SystemConditionConfig;
    return (
      <>
        <span className="form--ConditionOperatorLabel">{localInstance.equal}</span>
        <Select2
          value={config.layoutType || ""}
          onChange={(value) => updateConfig<SystemConditionConfig>({ layoutType: value })}
          options={[
            { label: localInstance.startup_condition_layout_single, value: "single" },
            { label: localInstance.startup_condition_layout_split, value: "split" },
          ]}
        />
      </>
    );
  }

  // 脚本表达式
  if (subType === UnifiedConditionSubType.ScriptExpression) {
    const config = condition.config as ScriptConditionConfig;
    return (
      <div className="form--ScriptConditionEditor">
        <textarea
          className="form--ScriptEditor"
          placeholder={localInstance.startup_condition_script_placeholder}
          value={config.expression || ""}
          onChange={(e) => updateConfig<ScriptConditionConfig>({ expression: e.target.value })}
        />
        <span className="form--ScriptHelpText">
          {localInstance.startup_condition_script_help}
        </span>
      </div>
    );
  }

  return null;
}

/**
 * Frontmatter 属性编辑器
 */
function FrontmatterPropertyEditor(props: {
  config: FileConditionConfig;
  formConfig?: FormConfig;
  onChange: (updates: Partial<FileConditionConfig>) => void;
}) {
  const { config, formConfig, onChange } = props;

  const handleAddProperty = () => {
    const properties = config.properties || [];
    onChange({
      properties: [...properties, { name: "", operator: ConditionOperator.Equals, value: "" }],
    });
  };

  const handleRemoveProperty = (index: number) => {
    const properties = config.properties || [];
    onChange({
      properties: properties.filter((_, i) => i !== index),
    });
  };

  const handleUpdateProperty = (index: number, updates: Partial<PropertyCheckConfig>) => {
    const properties = config.properties || [];
    onChange({
      properties: properties.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    });
  };

  return (
    <div className="form--FrontmatterPropertyEditor">
      <Select2
        value={config.targetMode || FileTargetMode.CurrentFile}
        onChange={(value) => onChange({ targetMode: value as FileTargetMode })}
        options={[
          { label: localInstance.startup_condition_current_file, value: FileTargetMode.CurrentFile },
          { label: localInstance.startup_condition_specific_file, value: FileTargetMode.SpecificFile },
        ]}
      />
      {config.targetMode === FileTargetMode.SpecificFile && (
        <VariableReferenceInput
          value={config.targetFilePath || ""}
          onChange={(value) => onChange({ targetFilePath: value })}
          placeholder={localInstance.startup_condition_file_path_placeholder}
          formConfig={formConfig}
          enableFileSearch={true}
          className="form--ConditionInputFlex"
        />
      )}
      
      <div className="form--PropertyList">
        {(config.properties && config.properties.length > 0) ? (
          config.properties.map((prop, index) => (
            <div key={index} className="form--PropertyItem">
              <VariableReferenceInput
                value={prop.name}
                onChange={(value) => handleUpdateProperty(index, { name: value })}
                placeholder={localInstance.property_name}
                formConfig={formConfig}
                style={{ width: 100 }}
              />
              <Select2
                value={prop.operator}
                onChange={(value) => handleUpdateProperty(index, { operator: value as ConditionOperator })}
                options={[
                  { label: localInstance.equal, value: ConditionOperator.Equals },
                  { label: localInstance.not_equal, value: ConditionOperator.NotEquals },
                  { label: localInstance.contains, value: ConditionOperator.Contains },
                ]}
              />
              <VariableReferenceInput
                value={prop.value}
                onChange={(value) => handleUpdateProperty(index, { value: value })}
                placeholder={localInstance.property_value}
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
          ))
        ) : (
          config.propertyName && (
            <div className="form--PropertyItem">
              <VariableReferenceInput
                value={config.propertyName || ""}
                onChange={(value) => onChange({ propertyName: value })}
                placeholder={localInstance.property_name}
                formConfig={formConfig}
                style={{ width: 100 }}
              />
              <Select2
                value={config.operator || ConditionOperator.Equals}
                onChange={(value) => onChange({ operator: value as ConditionOperator })}
                options={[
                  { label: localInstance.equal, value: ConditionOperator.Equals },
                  { label: localInstance.not_equal, value: ConditionOperator.NotEquals },
                  { label: localInstance.contains, value: ConditionOperator.Contains },
                ]}
              />
              <VariableReferenceInput
                value={config.propertyValue || ""}
                onChange={(value) => onChange({ propertyValue: value })}
                placeholder={localInstance.property_value}
                formConfig={formConfig}
                style={{ width: 100 }}
              />
            </div>
          )
        )}
        
        <button
          type="button"
          onClick={handleAddProperty}
          className="form--AddPropertyButton"
        >
          <Plus size={14} />
          {localInstance.startup_condition_add_property}
        </button>
      </div>
    </div>
  );
}

/**
 * 条件组组件
 */
function UnifiedConditionGroup(props: {
  condition: StartupCondition;
  formConfig?: FormConfig;
  onUpdate: (updates: Partial<StartupCondition>) => void;
}) {
  const { condition, formConfig, onUpdate } = props;

  const handleAddCondition = (subType: UnifiedConditionSubType) => {
    const newCondition = createNewCondition(subType);
    onUpdate({
      conditions: [...(condition.conditions || []), newCondition],
    });
  };

  const handleAddGroup = () => {
    const newGroup = createNewConditionGroup();
    onUpdate({
      conditions: [...(condition.conditions || []), newGroup],
    });
  };

  const handleRemoveChild = (id: string) => {
    onUpdate({
      conditions: (condition.conditions || []).filter((c) => c.id !== id),
    });
  };

  const handleDuplicateChild = (id: string) => {
    const child = (condition.conditions || []).find((c) => c.id === id);
    if (child) {
      const newChild = JSON.parse(JSON.stringify(child));
      newChild.id = v4();
      onUpdate({
        conditions: [...(condition.conditions || []), newChild],
      });
    }
  };

  const handleUpdateChild = (id: string, updates: Partial<StartupCondition>) => {
    onUpdate({
      conditions: (condition.conditions || []).map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    });
  };

  const handleRelationChange = (relation: ConditionRelation) => {
    onUpdate({ relation });
  };

  return (
    <div className="form--FilterGroup">
      {(condition.conditions || []).map((child, index) => (
        <UnifiedConditionItem
          key={child.id}
          condition={child}
          index={index}
          relation={condition.relation}
          formConfig={formConfig}
          onUpdate={(updates) => handleUpdateChild(child.id, updates)}
          onRemove={() => handleRemoveChild(child.id)}
          onDuplicate={() => handleDuplicateChild(child.id)}
          onRelationChange={handleRelationChange}
        />
      ))}
      <div className="form--FilterGroupAdd">
        <StartupConditionAddDropdown
          onAddCondition={handleAddCondition}
          onAddGroup={handleAddGroup}
        />
      </div>
    </div>
  );
}
