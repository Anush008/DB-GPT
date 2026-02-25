import {
  BarChartOutlined,
  BookOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  ConsoleSqlOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePptOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PieChartOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import classNames from 'classnames';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ObservationFormatter from './ObservationFormatter';
import MarkdownContext from '@/new-components/common/MarkdownContext';

export type StepStatus = 'pending' | 'running' | 'completed' | 'error';

export type StepType = 'read' | 'edit' | 'write' | 'bash' | 'grep' | 'glob' | 'task' | 'skill' | 'python' | 'html' | 'other';

export interface ExecutionStep {
  id: string;
  type: StepType;
  title: string;
  subtitle?: string;
  description?: string;
  status: StepStatus;
  output?: any;
}

export interface ThinkingSection {
  id: string;
  title: string;
  content?: string;
  isCompleted: boolean;
  steps: ExecutionStep[];
}

export interface ArtifactItem {
  id: string;
  type: 'file' | 'table' | 'chart' | 'image' | 'code' | 'markdown' | 'summary' | 'html';
  name: string;
  content: any;
  createdAt: number;
  downloadable?: boolean;
  mimeType?: string;
  size?: number;
  filePath?: string;
}

export interface ManusLeftPanelProps {
  sections: ThinkingSection[];
  activeStepId?: string | null;
  onStepClick?: (stepId: string, sectionId: string) => void;
  isWorking?: boolean;
  userQuery?: string;
  assistantText?: string;
  modelName?: string;
  stepThoughts?: Record<string, string>;
  artifacts?: ArtifactItem[];
  onArtifactClick?: (artifact: ArtifactItem) => void;
  onArtifactDownload?: (artifact: ArtifactItem) => void;
  onViewAllFiles?: () => void;
  isCollapsed?: boolean;
  onExpand?: () => void;
  attachedFile?: {
    name: string;
    size: number;
    type: string;
  };
  attachedKnowledge?: {
    id: number;
    name: string;
    vector_type: string;
    desc?: string;
    owner?: string;
  };
  attachedSkill?: {
    name: string;
    id: string;
  };
}

// Get step icon based on type and status
const getStepIcon = (type: StepType, status: StepStatus) => {
  const iconClass = 'text-sm';

  if (status === 'running') {
    return <LoadingOutlined spin className={classNames(iconClass, 'text-blue-500')} />;
  }

  switch (type) {
    case 'read':
      return <FileSearchOutlined className={classNames(iconClass, 'text-emerald-500')} />;
    case 'edit':
    case 'write':
      return <EditOutlined className={classNames(iconClass, 'text-amber-500')} />;
    case 'bash':
      return <ConsoleSqlOutlined className={classNames(iconClass, 'text-purple-500')} />;
    case 'grep':
    case 'glob':
      return <SearchOutlined className={classNames(iconClass, 'text-cyan-500')} />;
    case 'python':
      return <CodeOutlined className={classNames(iconClass, 'text-blue-500')} />;
    case 'html':
      return <CodeOutlined className={classNames(iconClass, 'text-orange-500')} />;
    case 'task':
    case 'skill':
      return <PlayCircleOutlined className={classNames(iconClass, 'text-indigo-500')} />;
    default:
      return <FileTextOutlined className={classNames(iconClass, 'text-gray-500')} />;
  }
};

// Get step type label in Chinese
const getTypeLabel = (type: StepType): string => {
  const labels: Record<StepType, string> = {
    read: '读取文件',
    edit: '编辑文件',
    write: '写入文件',
    bash: '执行命令',
    grep: '搜索内容',
    glob: '查找文件',
    task: '执行任务',
    skill: '加载技能',
    python: 'Python',
    html: 'HTML',
    other: '操作',
  };
  return labels[type] || '操作';
};

// Get icon background color based on type
const getIconBgClass = (type: StepType): string => {
  const bgClasses: Record<StepType, string> = {
    read: 'bg-emerald-50 dark:bg-emerald-900/30',
    edit: 'bg-amber-50 dark:bg-amber-900/30',
    write: 'bg-amber-50 dark:bg-amber-900/30',
    bash: 'bg-purple-50 dark:bg-purple-900/30',
    grep: 'bg-cyan-50 dark:bg-cyan-900/30',
    glob: 'bg-cyan-50 dark:bg-cyan-900/30',
    python: 'bg-blue-50 dark:bg-blue-900/30',
    html: 'bg-orange-50 dark:bg-orange-900/30',
    task: 'bg-indigo-50 dark:bg-indigo-900/30',
    skill: 'bg-indigo-50 dark:bg-indigo-900/30',
    other: 'bg-gray-50 dark:bg-gray-800',
  };
  return bgClasses[type] || 'bg-gray-50 dark:bg-gray-800';
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

const getFileTypeLabel = (fileName: string, mimeType?: string): string => {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['xlsx', 'xls'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return '电子表格';
  if (ext === 'csv' || mimeType?.includes('csv')) return '电子表格';
  if (ext === 'pdf' || mimeType?.includes('pdf')) return 'PDF';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) || mimeType?.includes('image')) return '图片';
  if (['doc', 'docx'].includes(ext) || mimeType?.includes('word')) return 'Word 文档';
  if (['txt', 'md'].includes(ext) || mimeType?.includes('text')) return '文本文件';
  return '文件';
};

const getFileIconElement = (fileName: string, mimeType?: string) => {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['xlsx', 'xls', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) {
    return <FileExcelOutlined className='text-green-600 text-base' />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) || mimeType?.includes('image')) {
    return <FileImageOutlined className='text-pink-500 text-base' />;
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return <FilePptOutlined className='text-orange-500 text-base' />;
  }
  return <FileTextOutlined className='text-blue-500 text-base' />;
};

// Get icon for artifact type
const getArtifactIcon = (artifact: ArtifactItem) => {
  switch (artifact.type) {
    case 'file':
      return getFileIconElement(artifact.name, artifact.mimeType);
    case 'html':
      return <DesktopOutlined className='text-blue-500 text-base' />;
    case 'table':
      return <TableOutlined className='text-blue-500 text-base' />;
    case 'chart':
      return <BarChartOutlined className='text-green-500 text-base' />;
    case 'image':
      return <FileImageOutlined className='text-pink-500 text-base' />;
    case 'code':
      return <CodeOutlined className='text-purple-500 text-base' />;
    case 'markdown':
      return <FileTextOutlined className='text-orange-500 text-base' />;
    case 'summary':
      return <FileTextOutlined className='text-emerald-500 text-base' />;
    default:
      return <FileOutlined className='text-gray-500 text-base' />;
  }
};

// Get artifact type label
const getArtifactTypeLabel = (artifact: ArtifactItem): string => {
  const labels: Record<string, string> = {
    file: '文件',
    html: '网页报告',
    table: '数据表',
    chart: '图表',
    image: '图片',
    code: '代码',
    markdown: '文档',
    summary: '总结',
  };
  return labels[artifact.type] || '产物';
};

// Get icon background for artifact type
const getArtifactIconBg = (type: string): string => {
  const bgs: Record<string, string> = {
    file: 'bg-gray-50 dark:bg-gray-800',
    html: 'bg-blue-50 dark:bg-blue-900/30',
    table: 'bg-blue-50 dark:bg-blue-900/30',
    chart: 'bg-green-50 dark:bg-green-900/30',
    image: 'bg-pink-50 dark:bg-pink-900/30',
    code: 'bg-purple-50 dark:bg-purple-900/30',
    markdown: 'bg-orange-50 dark:bg-orange-900/30',
    summary: 'bg-emerald-50 dark:bg-emerald-900/30',
  };
  return bgs[type] || 'bg-gray-50 dark:bg-gray-800';
};

// Artifact Card Component
const ArtifactCard: React.FC<{
  artifact: ArtifactItem;
  onClick?: () => void;
  onDownload?: () => void;
}> = memo(({ artifact, onClick, onDownload }) => {
  return (
    <div
      onClick={onClick}
      className='group flex items-center gap-3 px-3.5 py-3 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#1a1b1e] cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all duration-200'
    >
      <div className={classNames('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', getArtifactIconBg(artifact.type))}>
        {getArtifactIcon(artifact)}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{artifact.name}</div>
        <div className='text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5'>
          <span>{getArtifactTypeLabel(artifact)}</span>
          {artifact.size != null && (
            <>
              <span className='text-gray-300 dark:text-gray-600'>·</span>
              <span>{formatFileSize(artifact.size)}</span>
            </>
          )}
        </div>
      </div>
      {artifact.downloadable && (
        <Tooltip title='下载'>
          <Button
            type='text'
            size='small'
            icon={<DownloadOutlined />}
            className='text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0'
            onClick={e => {
              e.stopPropagation();
              onDownload?.();
            }}
          />
        </Tooltip>
      )}
    </div>
  );
});

ArtifactCard.displayName = 'ArtifactCard';

const StreamingText: React.FC<{ text: string }> = memo(({ text }) => {
  const [displayed, setDisplayed] = useState('');
  const prevLenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const queueRef = useRef('');
  const idxRef = useRef(0);

  useEffect(() => {
    if (text.length <= prevLenRef.current) {
      prevLenRef.current = text.length;
      setDisplayed(text);
      return;
    }
    const newChars = text.slice(prevLenRef.current);
    prevLenRef.current = text.length;
    queueRef.current += newChars;

    if (rafRef.current !== null) return;

    const flush = () => {
      const batch = Math.max(1, Math.ceil(queueRef.current.length / 12));
      const chunk = queueRef.current.slice(0, batch);
      queueRef.current = queueRef.current.slice(batch);
      idxRef.current += chunk.length;
      setDisplayed(prev => prev + chunk);
      if (queueRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(flush);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(flush);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [text]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <>{displayed}</>;
});

StreamingText.displayName = 'StreamingText';

const StepCard: React.FC<{
  step: ExecutionStep;
  isActive: boolean;
  onClick: () => void;
}> = memo(({ step, isActive, onClick }) => {
  const [isVisible, setIsVisible] = useState(false);
  const detailLine = step.detail ? step.detail.split('\n')[0] : '';

  React.useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      onClick={onClick}
      className={classNames(
        'group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200',
        'border bg-white dark:bg-[#1a1b1e]',
        'transform',
        {
          'opacity-0 translate-y-1': !isVisible,
          'opacity-100 translate-y-0': isVisible,
          'border-blue-300 dark:border-blue-700 shadow-sm ring-1 ring-blue-200/50 dark:ring-blue-800/50': isActive,
          'border-gray-200 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm':
            !isActive,
          'border-l-[3px] border-l-blue-500': step.status === 'running',
          'border-l-[3px] border-l-emerald-500': step.status === 'completed' && isActive,
          'border-l-[3px] border-l-red-500': step.status === 'error',
        },
      )}
      style={{
        transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
      }}
    >
      <div
        className={classNames(
          'flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center',
          getIconBgClass(step.type),
        )}
      >
        {getStepIcon(step.type, step.status)}
      </div>

      <span
        className={classNames('text-[10px] font-medium tracking-wide flex-shrink-0', {
          'text-emerald-600 dark:text-emerald-400': step.type === 'read',
          'text-amber-600 dark:text-amber-400': step.type === 'edit' || step.type === 'write',
          'text-purple-600 dark:text-purple-400': step.type === 'bash',
          'text-cyan-600 dark:text-cyan-400': step.type === 'grep' || step.type === 'glob',
          'text-blue-600 dark:text-blue-400': step.type === 'python',
          'text-orange-600 dark:text-orange-400': step.type === 'html',
          'text-indigo-600 dark:text-indigo-400': step.type === 'task' || step.type === 'skill',
          'text-gray-500': step.type === 'other',
        })}
      >
        {getTypeLabel(step.type)}
      </span>

      <div className='flex flex-col min-w-0 flex-1'>
        <span className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{step.title}</span>
        {detailLine && (
          <span className='text-[11px] text-gray-500 dark:text-gray-400 truncate'>{detailLine}</span>
        )}
      </div>

      <div className='flex-shrink-0'>
        {step.status === 'pending' && <ClockCircleOutlined className='text-xs text-gray-400' />}
        {step.status === 'running' && <LoadingOutlined spin className='text-xs text-blue-500' />}
        {step.status === 'completed' && <CheckCircleOutlined className='text-xs text-emerald-500' />}
        {step.status === 'error' && <ExclamationCircleOutlined className='text-xs text-red-500' />}
      </div>
    </div>
  );
});

StepCard.displayName = 'StepCard';

// Parse get_skill_resource step description to extract skill name, resource path, and content
const parseSkillResourceDescription = (
  description?: string,
): { skillName: string; resourcePath: string; content: string } | null => {
  if (!description) return null;
  try {
    // Extract Action Input JSON
    const inputMatch = description.match(/Action Input:\s*({[\s\S]*?})(?:\n|$)/);
    if (!inputMatch) return null;
    const input = JSON.parse(inputMatch[1]);
    const skillName = input.skill_name || '';
    const resourcePath = input.resource_path || '';

    // Extract the observation/output JSON that contains the file content
    const afterInput = description.slice(description.indexOf(inputMatch[0]) + inputMatch[0].length);
    let content = '';
    // Try to find JSON output with content field
    const jsonMatch = afterInput.match(/{[\s\S]*}/);
    if (jsonMatch) {
      try {
        const output = JSON.parse(jsonMatch[0]);
        content = output.content || '';
      } catch {
        content = afterInput.trim();
      }
    }

    if (!skillName && !resourcePath) return null;
    return { skillName, resourcePath, content };
  } catch {
    return null;
  }
};

// Component to render get_skill_resource step with skill name, resource name, and markdown content
const SkillResourceCard: React.FC<{
  step: ExecutionStep;
  isActive: boolean;
  onClick: () => void;
}> = memo(({ step, isActive, onClick }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const parsed = useMemo(() => parseSkillResourceDescription(step.description), [step.description]);

  React.useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  if (!parsed) {
    return <StepCard step={step} isActive={isActive} onClick={onClick} />;
  }

  const resourceName = parsed.resourcePath.split('/').pop() || parsed.resourcePath;
  const hasContent = parsed.content.length > 0;

  return (
    <div
      className={classNames(
        'rounded-lg border bg-white dark:bg-[#1a1b1e] transition-all duration-200 overflow-hidden',
        'transform',
        {
          'opacity-0 translate-y-1': !isVisible,
          'opacity-100 translate-y-0': isVisible,
          'border-blue-300 dark:border-blue-700 shadow-sm ring-1 ring-blue-200/50 dark:ring-blue-800/50': isActive,
          'border-gray-200 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm': !isActive,
          'border-l-[3px] border-l-blue-500': step.status === 'running',
          'border-l-[3px] border-l-emerald-500': step.status === 'completed' && isActive,
          'border-l-[3px] border-l-red-500': step.status === 'error',
        },
      )}
      style={{ transition: 'opacity 0.2s ease-out, transform 0.2s ease-out' }}
    >
      {/* Header row - clickable for right panel */}
      <div className='flex items-center gap-2.5 px-3 py-2 cursor-pointer' onClick={onClick}>
        <div className={classNames('flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center', getIconBgClass(step.type))}>
          {getStepIcon(step.type, step.status)}
        </div>
        <span className='text-[10px] font-medium tracking-wide flex-shrink-0 text-indigo-600 dark:text-indigo-400'>
          {getTypeLabel(step.type)}
        </span>
        <div className='flex flex-col min-w-0 flex-1'>
          <span className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{resourceName}</span>
          <span className='text-[11px] text-gray-400 dark:text-gray-500 truncate'>{parsed.skillName}</span>
        </div>
        <div className='flex-shrink-0'>
          {step.status === 'running' && <LoadingOutlined spin className='text-xs text-blue-500' />}
          {step.status === 'completed' && <CheckCircleOutlined className='text-xs text-emerald-500' />}
          {step.status === 'error' && <ExclamationCircleOutlined className='text-xs text-red-500' />}
        </div>
      </div>

    </div>
  );
});

SkillResourceCard.displayName = 'SkillResourceCard';

const ThoughtBubble: React.FC<{ text: string }> = memo(({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 60;
  const display = expanded || !isLong ? text : text.slice(0, 60) + '...';

  return (
    <div
      className={classNames('flex items-start gap-1.5 py-1 px-1 min-w-0', { 'cursor-pointer': isLong })}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <span className='text-[10px] text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0 select-none'>💭</span>
      <p className='text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed m-0 min-w-0 break-words italic'>
        <StreamingText text={display} />
        {isLong && !expanded && (
          <span className='text-[10px] text-gray-300 dark:text-gray-600 ml-1 not-italic'>▸</span>
        )}
      </p>
    </div>
  );
});

ThoughtBubble.displayName = 'ThoughtBubble';

// Section Component
const SectionBlock: React.FC<{
  section: ThinkingSection;
  activeStepId?: string | null;
  onStepClick: (stepId: string) => void;
  defaultExpanded?: boolean;
  stepThoughts?: Record<string, string>;
}> = memo(({ section, activeStepId, onStepClick, defaultExpanded = true, stepThoughts }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const completedCount = section.steps.filter(s => s.status === 'completed').length;
  const totalCount = section.steps.length;
  const isAllCompleted = completedCount === totalCount && totalCount > 0;
  const hasRunningStep = section.steps.some(s => s.status === 'running');

  const hasObservations = useMemo(() => {
    return section.steps.some(step => step.description?.includes('Observation:'));
  }, [section.steps]);

  return (
    <div className='mb-4'>
      {/* Section Header */}
      <div className='flex items-center gap-2 mb-3 cursor-pointer group' onClick={() => setIsExpanded(!isExpanded)}>
        {/* Status indicator */}
        <div
          className={classNames('w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300', {
            'bg-emerald-100 dark:bg-emerald-900/50 scale-110': isAllCompleted,
            'bg-blue-100 dark:bg-blue-900/50': hasRunningStep && !isAllCompleted,
            'bg-gray-100 dark:bg-gray-800': !isAllCompleted && !hasRunningStep,
          })}
        >
          {isAllCompleted ? (
            <CheckCircleFilled
              className={classNames('text-xs text-emerald-500 animate-bounce', {
                'animation-iteration-count-1': isAllCompleted,
              })}
            />
          ) : hasRunningStep ? (
            <LoadingOutlined spin className='text-xs text-blue-500' />
          ) : (
            <span className='w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500' />
          )}
        </div>

        {/* Section title */}
        <span className='text-sm font-medium text-gray-800 dark:text-gray-200 flex-1'>{section.title}</span>

        {/* Progress indicator */}
        {totalCount > 0 && (
          <span className='text-[10px] text-gray-400'>
            {completedCount}/{totalCount}
          </span>
        )}

        {/* Expand/collapse icon */}
        <span className='text-xs text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors'>
          {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
      </div>

      {/* Section Content */}
      {isExpanded && (
        <div className='ml-7 space-y-2 overflow-hidden'>
           {stepThoughts?.['initial'] && (
            <ThoughtBubble text={stepThoughts['initial']} />
          )}

          {section.steps.map(step => (
            <React.Fragment key={step.id}>
              {stepThoughts?.[step.id] && <ThoughtBubble text={stepThoughts[step.id]} />}
              {step.description?.includes('Action: get_skill_resource') ? (
                <SkillResourceCard step={step} isActive={step.id === activeStepId} onClick={() => onStepClick(step.id)} />
              ) : (
                <StepCard step={step} isActive={step.id === activeStepId} onClick={() => onStepClick(step.id)} />
              )}
              {step.description?.includes('Observation:') && (
                <ObservationFormatter observation={step.description} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
});

SectionBlock.displayName = 'SectionBlock';

// Main Component
const ManusLeftPanel: React.FC<ManusLeftPanelProps> = ({
  sections,
  activeStepId,
  onStepClick,
  isWorking,
  userQuery,
  assistantText,
  modelName,
  stepThoughts,
  artifacts,
  onArtifactClick,
  onArtifactDownload,
  onViewAllFiles,
  isCollapsed,
  onExpand,
  attachedFile,
  attachedKnowledge,
  attachedSkill,
}) => {
  const handleStepClick = useCallback(
    (stepId: string, sectionId: string) => {
      onStepClick?.(stepId, sectionId);
    },
    [onStepClick],
  );

  // Collapsed mode: show compact summary of the round
  if (isCollapsed) {
    return (
      <div
        onClick={onExpand}
        className='group px-4 py-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50/50 dark:hover:bg-[#1a1b1e]/50 transition-colors'
      >
        {/* User query bubble (compact) */}
        {userQuery && (
          <div className='flex justify-end mb-2'>
            <div className='max-w-[85%]'>
              <div className='rounded-2xl bg-gray-100 dark:bg-[#2a2b2f] px-3 py-2 text-sm text-gray-800 dark:text-gray-200 leading-relaxed line-clamp-2'>
                {userQuery}
              </div>
            </div>
          </div>
        )}
        {/* Truncated assistant response */}
        {assistantText && (
          <div className='text-sm text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed'>
            {assistantText.slice(0, 150)}{assistantText.length > 150 ? '...' : ''}
          </div>
        )}
        {/* Completed indicator */}
        {!assistantText && sections.length > 0 && (
          <div className='flex items-center gap-1.5 text-xs text-gray-400'>
            <CheckCircleFilled className='text-emerald-500' />
            <span>{sections.length} 个步骤已完成</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full'>
      <div className='flex-1 overflow-y-auto px-4 py-4 space-y-4'>
        {userQuery && (
          <div className='flex justify-end'>
            <div className='max-w-[85%] space-y-2'>
              {attachedFile && (
                <div className='flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#1a1b1e] shadow-sm'>
                  <div className='w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0'>
                    {getFileIconElement(attachedFile.name, attachedFile.type)}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{attachedFile.name}</div>
                    <div className='text-[11px] text-gray-400 dark:text-gray-500'>
                      {getFileTypeLabel(attachedFile.name, attachedFile.type)} · {formatFileSize(attachedFile.size)}
                    </div>
                  </div>
                </div>
              )}
              {attachedKnowledge && (
                <div className='flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#1a1b1e] shadow-sm'>
                  <div className='w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0'>
                    <BookOutlined className='text-orange-500 text-base' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{attachedKnowledge.name}</div>
                    <div className='text-[11px] text-gray-400 dark:text-gray-500'>
                      {attachedKnowledge.desc || attachedKnowledge.vector_type}
                    </div>
                  </div>
                </div>
              )}
              {attachedSkill && (
                <div className='flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#1a1b1e] shadow-sm'>
                  <div className='w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0'>
                    <PlayCircleOutlined className='text-indigo-500 text-base' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>{attachedSkill.name}</div>
                    <div className='text-[11px] text-gray-400 dark:text-gray-500'>技能</div>
                  </div>
                </div>
              )}
              <div className='rounded-2xl bg-gray-100 dark:bg-[#2a2b2f] px-4 py-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed'>
                {userQuery}
              </div>
            </div>
          </div>
        )}

        {sections.length > 0 ? (
          <div className='pt-1'>
            {sections.map((section, index) => (
              <SectionBlock
                key={section.id}
                section={section}
                activeStepId={activeStepId}
                onStepClick={stepId => handleStepClick(stepId, section.id)}
                defaultExpanded={index === sections.length - 1}
                stepThoughts={stepThoughts}
              />
            ))}
          </div>
        ) : (
          <div className='px-4 py-6 text-gray-400 space-y-2'>
            {isWorking ? (
              <div className='flex items-center gap-2'>
                <LoadingOutlined spin className='text-blue-500' />
                <span className='text-sm text-blue-600 dark:text-blue-400'>DB-GPT 正在思考 ···</span>
              </div>
            ) : (
              <span className='text-sm'>等待开始...</span>
            )}
            {isWorking && stepThoughts?.[activeStepId || 'initial'] && (
              <ThoughtBubble text={stepThoughts[activeStepId || 'initial']} />
            )}
          </div>
        )}

        {isWorking && sections.length > 0 && (
          <div className='px-4 py-3 mt-2 rounded-lg bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 space-y-2'>
            <div className='flex items-center gap-2'>
              <LoadingOutlined spin className='text-blue-500' />
              <span className='text-sm text-blue-600 dark:text-blue-400'>DB-GPT 正在思考 ···</span>
            </div>
            {stepThoughts?.[activeStepId || 'initial'] && (
              <ThoughtBubble text={stepThoughts[activeStepId || 'initial']} />
            )}
          </div>
        )}

        {assistantText && (
          <div className='mt-4 px-1'>
            <div className='prose prose-sm dark:prose-invert max-w-none text-gray-800 dark:text-gray-200 leading-relaxed'>
              <MarkdownContext>{assistantText}</MarkdownContext>
            </div>
          </div>
        )}

        {artifacts && artifacts.length > 0 && (
          <div className='mt-5 px-1'>
            <div className='flex flex-wrap gap-3'>
              {artifacts
                .filter(a => a.type === 'file' || a.type === 'html')
                .slice(0, 3)
                .map(artifact => (
                  <ArtifactCard
                    key={artifact.id}
                    artifact={artifact}
                    onClick={() => onArtifactClick?.(artifact)}
                    onDownload={() => onArtifactDownload?.(artifact)}
                  />
                ))}

              {onViewAllFiles && (
                <div
                  onClick={onViewAllFiles}
                  className='flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-[#1a1b1e] cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all duration-200 min-w-[200px]'
                >
                  <div className='w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50 dark:bg-gray-800'>
                    <FolderOpenOutlined className='text-gray-500 text-base' />
                  </div>
                  <span className='text-sm text-gray-600 dark:text-gray-300'>查看此任务中的所有文件</span>
                </div>
              )}
            </div>

            <div className='flex items-center gap-1.5 mt-4'>
              <CheckOutlined className='text-xs text-emerald-500' />
              <span className='text-sm text-emerald-600 dark:text-emerald-400 font-medium'>任务已完成</span>
            </div>
          </div>
        )}
      </div>

      {modelName && (
        <div className='px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50'>
          <div className='flex items-center justify-between text-[10px] text-gray-400'>
            <span>Model: {modelName}</span>
            {isWorking && <span className='animate-pulse'>Processing...</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ManusLeftPanel);
