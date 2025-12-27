/**
 * 扩展条件编辑器
 * 用于编辑时间条件、文件条件和脚本表达式条件
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { Clock, File, Variable, Code } from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { week } from "src/i18n/week";
import { Filter, FilterType } from "src/model/filter/Filter";
import { Select2 } from "src/component/select2/Select";
import {
  TimeConditionSubType,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
  ConditionOperator,
  PropertyCheckConfig,
} from "src/model/startup-condition/StartupCondition";
import type {
  TimeConditionConfig,
  FileConditionConfig,
  ScriptConditionConfig,
} from "src/model/startup-condition/StartupCondition";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { TFile } from "obsidian";
import { VariableReferenceInput } from "src/component/input/VariableReferenceInput";
import "./ExtendedConditionEditor.css";

/**
 * 时间条件子类型选项
 */
export function getTimeConditionSubTypeOptions() {
  return [
    {
      value: TimeConditionSubType.TimeRange,
      label: localInstance.startup_condition_time_range,
    },
    {
      value: TimeConditionSubType.DayOfWeek,
      label: localInstance.startup_condition_day_of_week,
    },
    {
      value: TimeConditionSubType.DateRange,
      label: localInstance.startup_condition_date_range,
    },
  ];
}

/**
 * 文件条件子类型选项
 */
export function getFileConditionSubTypeOptions() {
  return [
    {
      value: FileConditionSubType.FileExists,
      label: localInstance.startup_condition_file_exists,
    },
    {
      value: FileConditionSubType.FileStatus,
      label: localInstance.startup_condition_file_status,
    },
    {
      value: FileConditionSubType.ContentContains,
      label: localInstance.startup_condition_content_contains,
    },
    {
      value: FileConditionSubType.FrontmatterProperty,
      label: localInstance.startup_condition_frontmatter,
    },
  ];
}

/**
 * 创建默认的时间条件配置
 */
export function createDefaultTimeConditionConfig(subType: TimeConditionSubType): TimeConditionConfig {
  switch (subType) {
    case TimeConditionSubType.TimeRange:
      return {
        subType: TimeConditionSubType.TimeRange,
        startTime: "09:00",
        endTime: "18:00",
      };
    case TimeConditionSubType.DayOfWeek:
      return {
        subType: TimeConditionSubType.DayOfWeek,
        daysOfWeek: [1, 2, 3, 4, 5],
      };
    case TimeConditionSubType.DateRange:
      return {
        subType: TimeConditionSubType.DateRange,
        startDate: "",
        endDate: "",
      };
    case TimeConditionSubType.LastExecutionInterval:
      return {
        subType: TimeConditionSubType.LastExecutionInterval,
        intervalMinutes: 60,
      };
    default:
      return {
        subType: TimeConditionSubType.TimeRange,
        startTime: "09:00",
        endTime: "18:00",
      };
  }
}

/**
 * 创建默认的文件条件配置
 */
export function createDefaultFileConditionConfig(subType: FileConditionSubType): FileConditionConfig {
  switch (subType) {
    case FileConditionSubType.FileExists:
      return {
        subType: FileConditionSubType.FileExists,
        targetMode: FileTargetMode.SpecificFile,
        targetFilePath: "",
      };
    case FileConditionSubType.FileStatus:
      return {
        subType: FileConditionSubType.FileStatus,
        targetMode: FileTargetMode.SpecificFile,
        targetFilePath: "",
        fileStatusChecks: [FileStatusCheckType.IsOpen],
      };
    case FileConditionSubType.ContentContains:
      return {
        subType: FileConditionSubType.ContentContains,
        targetMode: FileTargetMode.CurrentFile,
        searchText: "",
      };
    case FileConditionSubType.FrontmatterProperty:
      return {
        subType: FileConditionSubType.FrontmatterProperty,
        targetMode: FileTargetMode.CurrentFile,
        properties: [],
        operator: ConditionOperator.Equals,
      };
    default:
      return {
        subType: FileConditionSubType.ContentContains,
        targetMode: FileTargetMode.CurrentFile,
        searchText: "",
      };
  }
}

/**
 * 创建默认的脚本条件配置
 */
export function createDefaultScriptConditionConfig(): ScriptConditionConfig {
  return {
    expression: "return true;",
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

/**
 * 时间条件编辑器
 */
export function TimeConditionEditor(props: {
  filter: Filter;
  onChange: (filter: Filter) => void;
}) {
  const { filter, onChange } = props;
  const config = (filter.extendedConfig as TimeConditionConfig) || createDefaultTimeConditionConfig(TimeConditionSubType.TimeRange);

  const updateConfig = (updates: Partial<TimeConditionConfig>) => {
    onChange({
      ...filter,
      extendedConfig: { ...config, ...updates },
    });
  };

  const handleSubTypeChange = (subType: TimeConditionSubType) => {
    const newConfig = createDefaultTimeConditionConfig(subType);
    onChange({
      ...filter,
      extendedConfig: newConfig,
    });
  };

  return (
    <div className="form--ExtendedConditionEditor">
      {/* 子类型选择 */}
      <Select2
        value={config.subType || TimeConditionSubType.TimeRange}
        onChange={(value) => handleSubTypeChange(value as TimeConditionSubType)}
        options={getTimeConditionSubTypeOptions()}
      />

      {/* 时间范围 */}
      {config.subType === TimeConditionSubType.TimeRange && (
        <>
          <Select2
            value={config.operator || ConditionOperator.Between}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getTimeRangeOperatorOptions()}
          />
          <input
            type="time"
            className="form--ConditionInput"
            value={config.startTime || "09:00"}
            onChange={(e) => updateConfig({ startTime: e.target.value })}
          />
          <span className="form--ConditionOperatorLabel">{localInstance.and_text || "至"}</span>
          <input
            type="time"
            className="form--ConditionInput"
            value={config.endTime || "18:00"}
            onChange={(e) => updateConfig({ endTime: e.target.value })}
          />
        </>
      )}

      {/* 星期几 */}
      {config.subType === TimeConditionSubType.DayOfWeek && (
        <>
          <Select2
            value={config.operator || ConditionOperator.In}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getDayOfWeekOperatorOptions()}
          />
          <div className="form--DayOfWeekPicker">
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <button
                key={index}
                type="button"
                className={(config.daysOfWeek || []).includes(index) ? "selected" : ""}
                title={week(index, "full")}
                onClick={() => {
                  const days = config.daysOfWeek || [];
                  const newDays = days.includes(index)
                    ? days.filter((d) => d !== index)
                    : [...days, index];
                  updateConfig({ daysOfWeek: newDays });
                }}
              >
                {week(index, "short")}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 日期范围 */}
      {config.subType === TimeConditionSubType.DateRange && (
        <>
          <Select2
            value={config.operator || ConditionOperator.Between}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getDateRangeOperatorOptions()}
          />
          <input
            type="date"
            className="form--ConditionInput"
            value={config.startDate || ""}
            onChange={(e) => updateConfig({ startDate: e.target.value })}
          />
          <span className="form--ConditionOperatorLabel">{localInstance.and_text || "至"}</span>
          <input
            type="date"
            className="form--ConditionInput"
            value={config.endDate || ""}
            onChange={(e) => updateConfig({ endDate: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

/**
 * 文件条件编辑器
 */
export function FileConditionEditor(props: {
  filter: Filter;
  onChange: (filter: Filter) => void;
}) {
  const { filter, onChange } = props;
  const config = (filter.extendedConfig as FileConditionConfig) || createDefaultFileConditionConfig(FileConditionSubType.ContentContains);

  const updateConfig = (updates: Partial<FileConditionConfig>) => {
    onChange({
      ...filter,
      extendedConfig: { ...config, ...updates },
    });
  };

  const handleSubTypeChange = (subType: FileConditionSubType) => {
    const newConfig = createDefaultFileConditionConfig(subType);
    onChange({
      ...filter,
      extendedConfig: newConfig,
    });
  };

  return (
    <div className="form--ExtendedConditionEditor">
      {/* 子类型选择 */}
      <Select2
        value={config.subType || FileConditionSubType.ContentContains}
        onChange={(value) => handleSubTypeChange(value as FileConditionSubType)}
        options={getFileConditionSubTypeOptions()}
      />

      {/* 文件存在 */}
      {config.subType === FileConditionSubType.FileExists && (
        <>
          <VariableReferenceInput
            value={config.targetFilePath || ""}
            onChange={(value) => updateConfig({ targetFilePath: value })}
            enableFileSearch={true}
            placeholder={localInstance.startup_condition_file_path_placeholder}
          />
          <Select2
            value={config.operator || ConditionOperator.Equals}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getFileExistsOperatorOptions()}
          />
        </>
      )}

      {/* 文件状态 */}
      {config.subType === FileConditionSubType.FileStatus && (
        <>
          <Select2
            value={config.operator || ConditionOperator.Equals}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getFileStatusOperatorOptions()}
          />
          <VariableReferenceInput
            value={config.targetFilePath || ""}
            onChange={(value) => updateConfig({ targetFilePath: value })}
            enableFileSearch={true}
            placeholder={localInstance.startup_condition_file_path_placeholder}
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
                  updateConfig({ fileStatusChecks: newChecks });
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
                  updateConfig({ fileStatusChecks: newChecks });
                }}
              />
              {localInstance.startup_condition_file_is_active}
            </label>
          </div>
        </>
      )}

      {/* 内容包含 */}
      {config.subType === FileConditionSubType.ContentContains && (
        <>
          <Select2
            value={config.targetMode || FileTargetMode.CurrentFile}
            onChange={(value) => updateConfig({ targetMode: value as FileTargetMode })}
            options={[
              { label: localInstance.startup_condition_current_file, value: FileTargetMode.CurrentFile },
              { label: localInstance.startup_condition_specific_file, value: FileTargetMode.SpecificFile },
            ]}
          />
          {config.targetMode === FileTargetMode.SpecificFile && (
            <VariableReferenceInput
              value={config.targetFilePath || ""}
              onChange={(value) => updateConfig({ targetFilePath: value })}
              enableFileSearch={true}
              placeholder={localInstance.startup_condition_file_path_placeholder}
            />
          )}
          <Select2
            value={config.operator || ConditionOperator.Contains}
            onChange={(value) => updateConfig({ operator: value as ConditionOperator })}
            options={getContentContainsOperatorOptions()}
          />
          <input
            type="text"
            className="form--ConditionInput form--ConditionInputFlex"
            placeholder={localInstance.startup_condition_search_text_placeholder}
            value={config.searchText || ""}
            onChange={(e) => updateConfig({ searchText: e.target.value })}
          />
        </>
      )}

      {/* 属性检查 */}
      {config.subType === FileConditionSubType.FrontmatterProperty && (
        <FrontmatterPropertyEditorCompact
          config={config}
          onChange={updateConfig}
        />
      )}
    </div>
  );
}

/**
 * 紧凑型 Frontmatter 属性编辑器
 */
function FrontmatterPropertyEditorCompact(props: {
  config: FileConditionConfig;
  onChange: (updates: Partial<FileConditionConfig>) => void;
}) {
  const { config, onChange } = props;
  const properties = config.properties || [];

  const handleAddProperty = () => {
    onChange({
      properties: [...properties, { name: "", operator: ConditionOperator.Equals, value: "" }],
    });
  };

  const handleRemoveProperty = (index: number) => {
    onChange({
      properties: properties.filter((_, i) => i !== index),
    });
  };

  const handleUpdateProperty = (index: number, updates: Partial<PropertyCheckConfig>) => {
    onChange({
      properties: properties.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    });
  };

  const operatorOptions = [
    { label: localInstance.equal, value: ConditionOperator.Equals },
    { label: localInstance.not_equal, value: ConditionOperator.NotEquals },
    { label: localInstance.contains, value: ConditionOperator.Contains },
    { label: localInstance.not_contains, value: ConditionOperator.NotContains },
  ];

  return (
    <div className="form--FrontmatterPropertyEditor">
      {/* 目标文件模式 */}
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
          enableFileSearch={true}
          placeholder={localInstance.startup_condition_file_path_placeholder}
        />
      )}

      {/* 属性列表 */}
      <div className="form--PropertyList">
        {properties.map((prop, index) => (
          <div key={index} className="form--PropertyItem">
            <input
              type="text"
              className="form--ConditionInput"
              placeholder={localInstance.property_name}
              value={prop.name}
              onChange={(e) => handleUpdateProperty(index, { name: e.target.value })}
            />
            <Select2
              value={prop.operator}
              onChange={(value) => handleUpdateProperty(index, { operator: value as ConditionOperator })}
              options={operatorOptions}
            />
            <input
              type="text"
              className="form--ConditionInput"
              placeholder={localInstance.property_value}
              value={prop.value}
              onChange={(e) => handleUpdateProperty(index, { value: e.target.value })}
            />
            <button
              type="button"
              className="form--RemovePropertyButton"
              onClick={() => handleRemoveProperty(index)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="form--AddPropertyButton"
          onClick={handleAddProperty}
        >
          + {localInstance.startup_condition_add_property}
        </button>
      </div>
    </div>
  );
}

/**
 * 脚本条件编辑器
 * 用于编辑 JavaScript 脚本表达式条件
 */
export function ScriptConditionEditor(props: {
  filter: Filter;
  onChange: (filter: Filter) => void;
}) {
  const { filter, onChange } = props;
  const config = (filter.extendedConfig as ScriptConditionConfig) || createDefaultScriptConditionConfig();

  const updateConfig = (updates: Partial<ScriptConditionConfig>) => {
    onChange({
      ...filter,
      extendedConfig: { ...config, ...updates },
    });
  };

  return (
    <div className="form--ExtendedConditionEditor form--ScriptConditionEditor">
      <textarea
        className="form--ScriptExpressionInput"
        placeholder={localInstance.filter_script_placeholder || "return true; // 返回 true 满足条件，返回 false 不满足条件"}
        value={config.expression || ""}
        onChange={(e) => updateConfig({ expression: e.target.value })}
        rows={3}
      />
      <div className="form--ScriptConditionHelp">
        <Code size={14} />
        <span>{localInstance.filter_script_help || "可用变量: app, currentFile, formFilePath, formValues"}</span>
      </div>
    </div>
  );
}

/**
 * 扩展条件编辑器入口组件
 * 根据 FilterType 选择合适的编辑器
 */
export function ExtendedConditionContent(props: {
  filter: Filter;
  onChange: (filter: Filter) => void;
}) {
  const { filter, onChange } = props;

  if (filter.type === FilterType.timeCondition) {
    return <TimeConditionEditor filter={filter} onChange={onChange} />;
  }

  if (filter.type === FilterType.fileCondition) {
    return <FileConditionEditor filter={filter} onChange={onChange} />;
  }

  if (filter.type === FilterType.scriptCondition) {
    return <ScriptConditionEditor filter={filter} onChange={onChange} />;
  }

  return null;
}
