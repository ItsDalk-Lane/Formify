/**
 * 扩展条件编辑器
 * 用于编辑时间条件和文件条件
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { Clock, File, Variable } from "lucide-react";
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
} from "src/model/startup-condition/StartupCondition";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { TFile } from "obsidian";
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
 * 文件路径输入组件（带文件建议）
 */
function FilePathInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { value, onChange, placeholder } = props;
  const app = useObsidianApp();
  const [fileSuggestions, setFileSuggestions] = useState<TFile[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // 搜索文件建议
    if (newValue.trim() && app) {
      const files = app.vault.getMarkdownFiles();
      const filtered = files
        .filter((f) => f.path.toLowerCase().includes(newValue.toLowerCase()))
        .slice(0, 10);
      setFileSuggestions(filtered);
      setShowDropdown(filtered.length > 0);
    } else {
      setShowDropdown(false);
    }
  };

  const selectFile = (file: TFile) => {
    onChange(file.path);
    setShowDropdown(false);
  };

  return (
    <div className="form--FilePathInputContainer">
      <input
        ref={inputRef}
        type="text"
        className="form--ConditionInput form--ConditionInputFlex"
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder || localInstance.startup_condition_file_path_placeholder}
      />
      {showDropdown && (
        <div ref={dropdownRef} className="form--FilePathDropdown">
          {fileSuggestions.map((file) => (
            <div
              key={file.path}
              className="form--FilePathItem"
              onClick={() => selectFile(file)}
            >
              <File size={14} />
              <div className="form--FilePathItemContent">
                <span className="form--FilePathItemName">{file.name}</span>
                <span className="form--FilePathItemPath">{file.path}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
          <span className="form--ConditionOperatorLabel">{localInstance.between || "在"}</span>
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
      )}

      {/* 日期范围 */}
      {config.subType === TimeConditionSubType.DateRange && (
        <>
          <span className="form--ConditionOperatorLabel">{localInstance.between || "在"}</span>
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
        <FilePathInput
          value={config.targetFilePath || ""}
          onChange={(value) => updateConfig({ targetFilePath: value })}
        />
      )}

      {/* 文件状态 */}
      {config.subType === FileConditionSubType.FileStatus && (
        <>
          <FilePathInput
            value={config.targetFilePath || ""}
            onChange={(value) => updateConfig({ targetFilePath: value })}
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
            <FilePathInput
              value={config.targetFilePath || ""}
              onChange={(value) => updateConfig({ targetFilePath: value })}
            />
          )}
          <span className="form--ConditionOperatorLabel">{localInstance.contains}</span>
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
        <FilePathInput
          value={config.targetFilePath || ""}
          onChange={(value) => onChange({ targetFilePath: value })}
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

  return null;
}
