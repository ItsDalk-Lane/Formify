import React, { useState, useRef, useEffect, useMemo, useContext } from "react";
import { createPortal } from "react-dom";
import { Variable, File } from "lucide-react";
import { TFile } from "obsidian";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { FormConfig } from "src/model/FormConfig";
import { FormField } from "src/model/field/IFormField";
import { FormConfigContext } from "src/hooks/useFormConfig";
import "./VariableReferenceInput.css";

/**
 * 允许的内置变量类型
 */
const ALLOWED_BUILTIN_VARIABLES = [
  { name: "date", pattern: "{{date}}", description: localInstance.builtin_var_date || "当前日期" },
  { name: "date:format", pattern: "{{date:YYYY-MM-DD}}", description: localInstance.builtin_var_date_format || "格式化日期" },
  { name: "time", pattern: "{{time}}", description: localInstance.builtin_var_time || "当前时间" },
  { name: "random", pattern: "{{random:10}}", description: localInstance.builtin_var_random || "随机字符串" },
];

/**
 * 获取可用的表单变量（返回所有字段）
 */
function getAvailableFormVariables(formConfig?: FormConfig): { name: string; label: string; defaultValue: any }[] {
  if (!formConfig || !formConfig.fields) return [];
  
  return formConfig.fields.map((field: FormField) => ({
    name: field.label,
    label: field.label,
    defaultValue: field.defaultValue,
  }));
}

interface VariableReferenceInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  formConfig?: FormConfig;
  style?: React.CSSProperties;
  enableFileSearch?: boolean;
  className?: string;
}

export function VariableReferenceInput(props: VariableReferenceInputProps) {
  const { value, onChange, placeholder, formConfig: propFormConfig, style, enableFileSearch, className } = props;
  const app = useObsidianApp();
  const contextFormConfig = useContext(FormConfigContext);
  const formConfig = propFormConfig || contextFormConfig || undefined;

  const [showDropdown, setShowDropdown] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<TFile[]>([]);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // Portal positioning state
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const formVariables = useMemo(() => getAvailableFormVariables(formConfig), [formConfig]);

  const updateDropdownPosition = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        minWidth: "200px"
      });
    }
  };

  useEffect(() => {
    if (showDropdown || showFileDropdown) {
      updateDropdownPosition();
      window.addEventListener("resize", updateDropdownPosition);
      window.addEventListener("scroll", updateDropdownPosition, true);
    }
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showDropdown, showFileDropdown]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if click is inside input wrapper
      if (wrapperRef.current && wrapperRef.current.contains(target)) {
        return;
      }

      // Check if click is inside dropdowns (which are in portals)
      // Since portals are in document.body, we can't easily check ref containment if we don't have refs to the portal content
      // But we can check if the target is inside an element with our specific class
      const targetElement = target as HTMLElement;
      if (targetElement.closest(".form--VariableReferenceDropdown") || targetElement.closest(".form--FilePathDropdown")) {
        return;
      }

      setShowDropdown(false);
      setShowFileDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const selectFile = (file: TFile) => {
    onChange(file.path);
    setShowFileDropdown(false);
    inputRef.current?.focus();
  };

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

    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variablePattern.length, start + variablePattern.length);
    }, 0);
  };

  return (
    <div className={`form--VariableReferenceInput ${className || ""}`} style={{ position: "relative", ...style }}>
      <div className="form--VariableReferenceInputWrapper" ref={wrapperRef}>
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

      {showDropdown && createPortal(
        <div className="form--VariableReferenceDropdown" style={dropdownStyle}>
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
                  {v.defaultValue !== undefined && v.defaultValue !== null && v.defaultValue !== "" && (
                    <span className="form--VariableReferenceDesc">
                      {localInstance.default_value || "默认值"}: {String(v.defaultValue)}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}

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
        </div>,
        document.body
      )}

      {showFileDropdown && createPortal(
        <div className="form--FilePathDropdown" style={dropdownStyle}>
          {fileSuggestions.map((file) => (
            <div
              key={file.path}
              className="form--FilePathItem"
              onClick={() => selectFile(file)}
            >
              <File size={14} />
              <span className="form--FilePathItemName">{file.path}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
