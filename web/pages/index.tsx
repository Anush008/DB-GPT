import { ChatContext } from '@/app/chat-context';
import ModelSelector from '@/components/chat/header/model-selector';
import { ColumnAnalysis, PreprocessingResult, analyzeDataset } from '@/new-components/analysis';
import { ChartConfig, ChartType } from '@/new-components/charts';
import ManusLeftPanel, {
  ExecutionStep as ManusExecutionStep,
  StepType,
  ThinkingSection,
} from '@/new-components/chat/content/ManusLeftPanel';
import ManusRightPanel, {
  ActiveStepInfo,
  ExecutionOutput as ManusExecutionOutput,
  PanelView,
} from '@/new-components/chat/content/ManusRightPanel';
import { MessagePart, ToolPart, ToolStatus } from '@/new-components/chat/content/OpenCodeSessionTurn';
import axios from '@/utils/ctx-axios';
import { sendSpacePostRequest } from '@/utils/request';
import {
  ArrowUpOutlined,
  AudioOutlined,
  BarChartOutlined,
  BellOutlined,
  BookOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CodeOutlined,
  ConsoleSqlOutlined,
  DatabaseOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePptOutlined,
  FileTextOutlined,
  PieChartOutlined,
  PlusOutlined,
  ReadOutlined,
  RightOutlined,
  SearchOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useRequest } from 'ahooks';
import {
  Avatar,
  Button,
  ConfigProvider,
  Dropdown,
  Input,
  List,
  Modal,
  Popover,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import { NextPage } from 'next';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const cleanFinalContent = (text: string): string => {
  let cleaned = text.replace(/\\n/g, '\n').trim();
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/"\s*\}\s*$/, '').trim();
  return cleaned;
};

const _formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

const _getFileTypeLabel = (fileName: string, mimeType?: string): string => {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['xlsx', 'xls'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
    return '电子表格';
  }
  if (ext === 'csv' || mimeType?.includes('csv')) {
    return '电子表格';
  }
  if (ext === 'pdf' || mimeType?.includes('pdf')) return 'PDF';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) || mimeType?.includes('image')) return '图片';
  if (['doc', 'docx'].includes(ext) || mimeType?.includes('word')) return 'Word 文档';
  if (['txt', 'md'].includes(ext) || mimeType?.includes('text')) return '文本文件';
  if (['json'].includes(ext)) return 'JSON';
  return '文件';
};

const _getFileIcon = (fileName: string, mimeType?: string) => {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (
    ['xlsx', 'xls', 'csv'].includes(ext) ||
    mimeType?.includes('spreadsheet') ||
    mimeType?.includes('excel') ||
    mimeType?.includes('csv')
  ) {
    return <FileExcelOutlined className='text-green-600 text-lg' />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) || mimeType?.includes('image')) {
    return <FileImageOutlined className='text-pink-500 text-lg' />;
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return <FilePptOutlined className='text-orange-500 text-lg' />;
  }
  return <FileTextOutlined className='text-blue-500 text-lg' />;
};

interface DataSource {
  id: number;
  type: string;
  params: Record<string, any>;
  description?: string;
  db_name: string;  // derived from params.name
  db_type: string;  // alias for type
  gmt_created?: string;
  gmt_modified?: string;
}

// Define Knowledge Base Interface (Partial)
interface KnowledgeSpace {
  id: number;
  name: string;
  vector_type: string;
  desc?: string;
  owner?: string;
}

// Define file attachment type for user messages
interface FileAttachment {
  name: string;
  size: number;
  type: string;
}

// Define message type for chat
interface ChatMessage {
  id?: string;
  role: 'human' | 'view';
  context: string;
  model_name?: string;
  order?: number;
  thinking?: boolean;
  attachedFile?: FileAttachment;
  attachedKnowledge?: KnowledgeSpace;
  attachedSkill?: { name: string; id: string };
  attachedDb?: { db_name: string; db_type: string };
}

interface ExecutionStep {
  id: string;
  step: number;
  title?: string;
  detail: string;
  status: 'running' | 'done' | 'failed';
}

interface ExecutionOutput {
  output_type: string;
  content: any;
}

interface FilePreview {
  kind: 'table' | 'text';
  file_name?: string;
  file_path?: string;
  columns?: string[];
  rows?: Record<string, any>[];
  text?: string;
  shape?: [number, number];
}

interface ChartPreview {
  chartType?: ChartType;
  data: Array<{ x: string | number; y: number; [key: string]: any }>;
  xField: string;
  yField: string;
  seriesField?: string;
  colorField?: string;
  angleField?: string;
  title?: string;
  description?: string;
  smooth?: boolean;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  type: 'official' | 'personal';
  icon?: string;
}

type ArtifactType = 'file' | 'table' | 'chart' | 'image' | 'code' | 'markdown' | 'summary' | 'html';

interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content: any;
  createdAt: number;
  messageId?: string;
  stepId?: string;
  downloadable?: boolean;
  mimeType?: string;
  size?: number;
  // Chart-specific metadata
  chartType?: ChartType;
  chartConfig?: Partial<ChartConfig>;
}

type RightPanelTab = 'preview' | 'files' | 'charts' | 'tables' | 'analysis' | 'preprocess' | 'summary';

const _convertExecutionToMessageParts = (
  execution:
    | {
        steps: ExecutionStep[];
        outputs: Record<string, ExecutionOutput[]>;
        activeStepId: string | null;
        collapsed: boolean;
      }
    | undefined,
): MessagePart[] => {
  if (!execution || !execution.steps.length) return [];

  return execution.steps.map((step): ToolPart => {
    const outputs = execution.outputs[step.id] || [];
    const outputText = outputs
      .map(o => {
        if (o.output_type === 'text' || o.output_type === 'markdown') {
          return String(o.content);
        }
        if (o.output_type === 'code') {
          return `\`\`\`\n${String(o.content)}\n\`\`\``;
        }
        if (o.output_type === 'table' || o.output_type === 'json') {
          return JSON.stringify(o.content, null, 2);
        }
        if (o.output_type === 'html') {
          return '[HTML Report]';
        }
        return String(o.content);
      })
      .filter(Boolean)
      .join('\n');

    const statusMap: Record<string, ToolStatus> = {
      running: 'running',
      done: 'completed',
      failed: 'error',
    };

    const toolName = step.title?.toLowerCase().includes('skill')
      ? 'skill'
      : step.title?.toLowerCase().includes('read')
        ? 'read'
        : step.title?.toLowerCase().includes('write')
          ? 'write'
          : step.title?.toLowerCase().includes('code') || step.title?.toLowerCase().includes('execute')
            ? 'bash'
            : 'task';

    return {
      id: step.id,
      type: 'tool',
      tool: toolName,
      state: {
        status: statusMap[step.status] || 'completed',
        input: { description: step.title || 'Step', detail: step.detail },
        output: outputText || step.detail,
      },
    };
  });
};

// Convert execution data to Manus panel format
const convertToManusFormat = (
  execution:
    | {
        steps: ExecutionStep[];
        outputs: Record<string, ExecutionOutput[]>;
        activeStepId: string | null;
        collapsed: boolean;
        stepThoughts?: Record<string, string>;
      }
    | undefined,
  _userQuery?: string,
): {
  sections: ThinkingSection[];
  activeStep: ActiveStepInfo | null;
  outputs: ManusExecutionOutput[];
  stepThoughts: Record<string, string>;
} => {
  if (!execution || !execution.steps.length) {
    return { sections: [], activeStep: null, outputs: [], stepThoughts: execution?.stepThoughts || {} };
  }

  // Determine step type from title
  const getStepType = (title?: string): StepType => {
    const lower = (title || '').toLowerCase();
    if (lower.includes('load_skill') || lower.includes('load skill')) return 'skill';
    if (lower.includes('sql_query') || lower.includes('sql query') || lower.includes('sql查询')) return 'sql';
    if (lower.includes('read') || lower.includes('load')) return 'read';
    if (lower.includes('edit')) return 'edit';
    if (lower.includes('write') || lower.includes('save')) return 'write';
    if (lower.includes('bash') || lower.includes('execute') || lower.includes('command') || lower.includes('shell'))
      return 'bash';
    if (lower.includes('grep') || lower.includes('search')) return 'grep';
    if (lower.includes('glob') || lower.includes('find')) return 'glob';
    if (lower.includes('html')) return 'html';
    if (lower.includes('python') || lower.includes('code')) return 'python';
    if (lower.includes('skill')) return 'skill';
    if (lower.includes('task')) return 'task';
    return 'other';
  };

  // Get step status mapping
  const getStepStatus = (status: string): 'pending' | 'running' | 'completed' | 'error' => {
    if (status === 'running') return 'running';
    if (status === 'done') return 'completed';
    if (status === 'failed') return 'error';
    return 'pending';
  };

  // Group steps into sections (for now, create one section with all steps)
  // In a more advanced version, you could group by phase/category
  const steps: ManusExecutionStep[] = execution.steps
    .filter(step => {
      const detail = (step.detail || '').toLowerCase();
      return !detail.includes('action: terminate');
    })
    .map(step => {
      const cleanDetail = step.detail?.replace(/^Thought:.*\n?/gm, '').trim();
      return {
        id: step.id,
        type: getStepType(step.title),
        title: step.title || `Step ${step.step}`,
        subtitle: cleanDetail?.split('\n')[0]?.slice(0, 80),
        description: cleanDetail || undefined,
        phase: (step as any).phase,
        status: getStepStatus(step.status),
      };
    });

  // Create section(s)
  const sections: ThinkingSection[] = [];
  // Group steps by phase (free-text from model), preserving order of first appearance
  const phaseOrder: string[] = [];
  const phaseGroups: Record<string, typeof steps> = {};
  for (const s of steps) {
    const key = s.phase || '__default__';
    if (!phaseGroups[key]) {
      phaseGroups[key] = [];
      phaseOrder.push(key);
    }
    phaseGroups[key].push(s);
  }

  for (const key of phaseOrder) {
    const group = phaseGroups[key];
    sections.push({
      id: `section-${key}`,
      title: key === '__default__' ? '执行步骤' : key,
      isCompleted: group.every(s => s.status === 'completed'),
      steps: group,
    });
  }

  // Get active step info
  let activeStep: ActiveStepInfo | null = null;
  if (execution.activeStepId) {
    const step = execution.steps.find(s => s.id === execution.activeStepId);
    if (step) {
      const cleanDetail = step.detail?.replace(/^Thought:.*\n?/gm, '').trim();
      activeStep = {
        id: step.id,
        type: getStepType(step.title),
        title: step.title || `Step ${step.step}`,
        subtitle: cleanDetail?.split('\n')[0]?.slice(0, 80),
        status: getStepStatus(step.status),
        detail: cleanDetail,
      };
    }
  }

  // Get outputs for active step
  const outputs: ManusExecutionOutput[] = execution.activeStepId
    ? (execution.outputs[execution.activeStepId] || []).map(o => ({
        output_type: o.output_type as any,
        content: o.content,
        timestamp: Date.now(),
      }))
    : [];

  return { sections, activeStep, outputs, stepThoughts: execution?.stepThoughts || {} };
};

const EXAMPLE_CARDS = [
  {
    id: 'walmart_sales',
    icon: '📊',
    title: '沃尔玛销售数据分析',
    description: '分析沃尔玛销售CSV数据，生成可视化网页报告',
    query:
      '请全面分析这份沃尔玛销售数据，包括各门店销售趋势、假日影响、温度与油价对销售的影响等维度，生成一份精美的交互式网页分析报告。',
    fileName: 'Walmart_Sales.csv',
    fileType: 'text/csv',
    fileSize: 98304, // ~96 KB
    color: 'from-blue-500/10 to-cyan-500/10',
    borderColor: 'border-blue-200/60 dark:border-blue-800/40',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    skillName: 'walmart-sales-analyzer',
  },
  {
    id: 'csv_visual_report',
    icon: '📋',
    title: '自主分析表格',
    description: '自主分析CSV表格数据，生成可视化网页报告',
    query:
      '请自主分析这份表格，理解数据结构、字段含义和基本信息，然后进行深入分析并生成一份精美的可视化网页报告。',
    fileName: 'Walmart_Sales.csv',
    fileType: 'text/csv',
    fileSize: 363735, // ~355.21 KB
    color: 'from-emerald-500/10 to-teal-500/10',
    borderColor: 'border-emerald-200/60 dark:border-emerald-800/40',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
  },
  {
    id: 'fin_report',
    icon: '📈',
    title: '金融财报深度分析',
    description: '分析浙江海翔药业年度报告，生成数据可视化报告',
    query:
      '请深度分析这份浙江海翔药业2019年年度报告，包括营收利润趋势、资产负债结构、现金流分析、关键财务指标等，生成一份专业的交互式网页分析报告。',
    fileName: '2020-01-23__浙江海翔药业股份有限公司__002099__海翔药业__2019年__年度报告.pdf',
    fileType: 'application/pdf',
    fileSize: 2621440, // ~2.5 MB
    color: 'from-violet-500/10 to-purple-500/10',
    borderColor: 'border-violet-200/60 dark:border-violet-800/40',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    skillName: 'financial-report-analyzer',
  },
];

const Playground: NextPage = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const { model, setModel } = useContext(ChatContext);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Selection State
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);

  // Contexts
  const [selectedDb, setSelectedDb] = useState<DataSource | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeSpace | null>(null);
  const [uploadedFile, setUploadedFile] = useState<any | null>(null);

  // Chat messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [executionMap, setExecutionMap] = useState<
    Record<
      string,
      {
        steps: ExecutionStep[];
        outputs: Record<string, ExecutionOutput[]>;
        activeStepId: string | null;
        collapsed: boolean;
        stepThoughts: Record<string, string>;
      }
    >
  >({});
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [_filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [_filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [chartPreview, setChartPreview] = useState<ChartPreview | null>(null);
  const lastArtifactKeyRef = useRef<string>('');

  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [_rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('preview');
  const [streamingSummary, setStreamingSummary] = useState<string>('');
  const [_summaryComplete, setSummaryComplete] = useState(false);
  const [_dataAnalysis, setDataAnalysis] = useState<ColumnAnalysis[] | null>(null);
  const [_analysisLoading, setAnalysisLoading] = useState(false);
  const [_showProfessionalReport, _setShowProfessionalReport] = useState(false);
  const [_preprocessedData, _setPreprocessedData] = useState<PreprocessingResult | null>(null);

  const [isSkillPanelOpen, setIsSkillPanelOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  const [isKnowledgePanelOpen, setIsKnowledgePanelOpen] = useState(false);
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState('');

  const [isDbPanelOpen, setIsDbPanelOpen] = useState(false);
  const [dbSearchQuery, setDbSearchQuery] = useState('');

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<PanelView>('execution');
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);

  // Active round tracking: which view message is currently selected for the right panel
  const [activeViewMsgId, setActiveViewMsgId] = useState<string | null>(null);

  // Track step IDs that belong to a terminate action so we can suppress them
  const terminatedStepIdsRef = useRef<Set<string>>(new Set());
  const preloadedFilePathRef = useRef<string | null>(null);

  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch Data Sources
  const { data: dataSources, loading: _loadingSources } = useRequest(async () => {
    try {
      const response: any = await axios.get('/api/v2/serve/datasources');
      // ctx-axios interceptor returns response.data directly, so response is {success, data, ...}
      const result = response?.success !== undefined ? response : response?.data;
      if (result?.success) {
        return (result.data || []).map((item: any) => ({
          ...item,
          db_name: item.db_name || item.params?.name || item.params?.database || `${item.type}-${item.id}`,
          db_type: item.type,
        })) as DataSource[];
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch datasources', e);
      return [];
    }
  });

  // Fetch Knowledge Bases
  const { data: knowledgeSpaces, loading: _loadingKnowledge } = useRequest(async () => {
    try {
      const response = await sendSpacePostRequest('/knowledge/space/list', {});
      // ctx-axios interceptor returns response.data directly, so response is {success, data, ...}
      if (response?.success) {
        return response.data || [];
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch knowledge spaces', e);
      return [];
    }
  });

  // Fetch Skills/DBGPTs list
  const { data: skillsList, loading: _loadingSkills } = useRequest(async () => {
    try {
      const response = await axios.get(`${process.env.API_BASE_URL ?? ''}/api/v1/skills/list`);
      // ctx-axios interceptor returns response.data directly
      if (response?.success && Array.isArray(response.data)) {
        return response.data.map((item: any) => ({
          id: String(item.id || item.name),
          name: item.name,
          description: item.description || '',
          type: item.type === 'official' ? 'official' : 'personal',
          icon:
            item.skill_type === 'data_analysis'
              ? '📊'
              : item.skill_type === 'coding'
                ? '💻'
                : item.skill_type === 'web_search'
                  ? '🔍'
                  : item.skill_type === 'knowledge_qa'
                    ? '📚'
                    : item.skill_type === 'chat'
                      ? '💬'
                      : '⚡',
        })) as Skill[];
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch skills', e);
      return [];
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const convId = router.query.id as string | undefined;
    if (convId && convId !== conversationId) {
      loadConversation(convId);
    }
  }, [router.query.id]);

  useEffect(() => {
    const lastView = [...messages].reverse().find(msg => msg.role === 'view');
    if (lastView?.id) {
      setActiveMessageId(lastView.id);
    }
  }, [messages]);

  useEffect(() => {
    const loadPreview = async () => {
      if (!uploadedFilePath) return;
      setFilePreviewLoading(true);
      setFilePreviewError(null);
      try {
        const res = await axios.post(`${process.env.API_BASE_URL ?? ''}/api/v1/resource/file/read`, null, {
          params: {
            conv_uid: conversationId || 'preview',
            file_key: uploadedFilePath,
          },
        });
        if (res.data?.success && res.data?.data) {
          let parsed: any;
          try {
            parsed = JSON.parse(res.data.data);
          } catch {
            parsed = res.data.data;
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            const columns = Object.keys(parsed[0] || {});
            setFilePreview({
              kind: 'table',
              file_name: uploadedFile?.name,
              file_path: uploadedFilePath,
              columns,
              rows: parsed.slice(0, 50),
              shape: [parsed.length, columns.length],
            });
          } else if (typeof parsed === 'string') {
            setFilePreview({
              kind: 'text',
              file_name: uploadedFile?.name,
              file_path: uploadedFilePath,
              text: parsed,
            });
          } else {
            setFilePreview({
              kind: 'text',
              file_name: uploadedFile?.name,
              file_path: uploadedFilePath,
              text: JSON.stringify(parsed, null, 2),
            });
          }
        } else {
          setFilePreviewError(res.data?.err_msg || '文件预览失败');
        }
      } catch (err: any) {
        setFilePreviewError(err?.message || '文件预览失败');
      } finally {
        setFilePreviewLoading(false);
      }
    };
    loadPreview();
  }, [uploadedFilePath, conversationId, uploadedFile]);

  useEffect(() => {
    if (!filePreview || filePreview.kind !== 'table') {
      setChartPreview(null);
      return;
    }
    const rows = filePreview.rows || [];
    const columns = filePreview.columns || [];
    if (!rows.length || !columns.length) {
      setChartPreview(null);
      return;
    }
    const numericColumns = columns.filter(col => {
      const sample = rows.slice(0, 20).map(row => Number(row[col]));
      const numericCount = sample.filter(val => Number.isFinite(val)).length;
      return numericCount >= Math.max(3, Math.floor(sample.length * 0.6));
    });
    if (!numericColumns.length) {
      setChartPreview(null);
      return;
    }
    const yCol = numericColumns[0];
    const xCol = columns.find(col => col !== yCol) || '__index__';
    const data = rows.slice(0, 60).map((row, idx) => {
      const xVal = xCol === '__index__' ? idx + 1 : row[xCol];
      const yVal = Number(row[yCol]);
      return {
        x: typeof xVal === 'string' || typeof xVal === 'number' ? xVal : String(xVal ?? idx + 1),
        y: Number.isFinite(yVal) ? yVal : 0,
      };
    });
    setChartPreview({
      data,
      xField: 'x',
      yField: 'y',
      title: `${yCol} trend`,
    });
  }, [filePreview]);

  // Auto-analyze data when filePreview updates
  useEffect(() => {
    if (!filePreview || filePreview.kind !== 'table' || !filePreview.rows?.length) {
      setDataAnalysis(null);
      return;
    }

    setAnalysisLoading(true);
    try {
      const analysis = analyzeDataset(filePreview.rows, filePreview.columns);
      setDataAnalysis(analysis);
      // Auto-switch to analysis tab when data is ready
      if (analysis.length > 0) {
        setRightPanelTab('analysis');
      }
    } catch (err) {
      console.error('Data analysis failed:', err);
      setDataAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, [filePreview]);

  useEffect(() => {
    if (!activeMessageId || !filePreview) return;
    const artifactKey = `${activeMessageId}:${filePreview.file_path || filePreview.file_name || ''}`;
    if (artifactKey === lastArtifactKeyRef.current) return;
    lastArtifactKeyRef.current = artifactKey;
    const previewStepId = 'client-preview';
    setExecutionMap(prev => {
      const current = prev[activeMessageId] || { steps: [], outputs: {}, activeStepId: null, collapsed: false };
      const hasStep = current.steps.some(step => step.id === previewStepId);
      const nextSteps = hasStep
        ? current.steps.map(step => (step.id === previewStepId ? { ...step, status: 'done' as const } : step))
        : [
            ...current.steps,
            {
              id: previewStepId,
              step: current.steps.length + 1,
              title: 'Preview & Visualize',
              detail: 'Parsed file preview and prepared visual insights.',
              status: 'done' as const,
            },
          ];
      const outputs = { ...current.outputs };
      const previewOutputs: ExecutionOutput[] = [];
      if (filePreview.kind === 'table') {
        previewOutputs.push({
          output_type: 'table',
          content: {
            columns: (filePreview.columns || []).map(col => ({ title: col, dataIndex: col, key: col })),
            rows: filePreview.rows || [],
          },
        });
      } else if (filePreview.kind === 'text') {
        previewOutputs.push({ output_type: 'text', content: filePreview.text || '' });
      }
      if (chartPreview) {
        previewOutputs.push({
          output_type: 'chart',
          content: {
            data: chartPreview.data,
            xField: chartPreview.xField,
            yField: chartPreview.yField,
          },
        });
      }
      outputs[previewStepId] = previewOutputs;
      return {
        ...prev,
        [activeMessageId]: {
          ...current,
          steps: nextSteps,
          outputs,
          activeStepId: previewStepId,
        },
      };
    });
  }, [activeMessageId, filePreview, chartPreview]);

  interface Round {
    humanMsg: ChatMessage | null;
    viewMsg: ChatMessage | null;
  }

  const rounds = useMemo<Round[]>(() => {
    const result: Round[] = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      if (msg.role === 'human') {
        const next = messages[i + 1];
        if (next && next.role === 'view') {
          result.push({ humanMsg: msg, viewMsg: next });
          i += 2;
        } else {
          result.push({ humanMsg: msg, viewMsg: null });
          i += 1;
        }
      } else if (msg.role === 'view') {
        result.push({ humanMsg: null, viewMsg: msg });
        i += 1;
      } else {
        i += 1;
      }
    }
    return result;
  }, [messages]);

  const selectedViewMsgId = useMemo(() => {
    if (activeViewMsgId) {
      const exists = rounds.some(r => r.viewMsg?.id === activeViewMsgId);
      if (exists) return activeViewMsgId;
    }
    const lastRound = rounds[rounds.length - 1];
    return lastRound?.viewMsg?.id || null;
  }, [activeViewMsgId, rounds]);

  const parseCsvLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(val => val.trim());
  };

  const _parseCsvText = (text: string, fileName?: string) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) return null;
    const header = parseCsvLine(lines[0]);
    const rows = lines.slice(1, 51).map((line, idx) => {
      const values = parseCsvLine(line);
      const row: Record<string, any> = { id: idx + 1 };
      header.forEach((col, i) => {
        row[col || `col_${i + 1}`] = values[i] ?? '';
      });
      return row;
    });
    return {
      kind: 'table' as const,
      file_name: fileName,
      columns: header.map(col => col || 'Column'),
      rows,
      shape: [lines.length - 1, header.length],
    };
  };

  const _getArtifactName = (outputType: string, content: any): string => {
    if (outputType === 'table') {
      const rowCount = content?.rows?.length || 0;
      const colCount = content?.columns?.length || 0;
      return `Data Table (${rowCount} rows × ${colCount} cols)`;
    }
    if (outputType === 'chart') {
      const chartType = content?.chartType || 'line';
      const chartTypeNames: Record<string, string> = {
        line: 'Line Chart',
        column: 'Column Chart',
        bar: 'Bar Chart',
        pie: 'Pie Chart',
        donut: 'Donut Chart',
        area: 'Area Chart',
        scatter: 'Scatter Plot',
        'dual-axes': 'Dual Axes Chart',
      };
      return content?.title || chartTypeNames[chartType] || 'Chart Visualization';
    }
    if (outputType === 'code') {
      return `Code Snippet`;
    }
    if (outputType === 'image') {
      return content?.name || 'Image';
    }
    if (outputType === 'markdown') {
      const preview = String(content).slice(0, 30);
      return `Document: ${preview}${String(content).length > 30 ? '...' : ''}`;
    }
    if (outputType === 'file') {
      return content?.name || content?.file_name || 'File';
    }
    return `${outputType} output`;
  };

  const extractCodeFileName = (code: string, stepLabel: string, index: number): string => {
    const saveMatch = code.match(/\.to_(?:excel|csv)\s*\(\s*['"]([^'"]+)['"]/);
    if (saveMatch) return saveMatch[1].split('/').pop() || saveMatch[1];
    const openMatch = code.match(/open\s*\(\s*['"]([^'"]+\.(?:py|txt|json|csv|xlsx?))['"]/);
    if (openMatch) return openMatch[1].split('/').pop() || openMatch[1];

    const savefigMatch = code.match(/savefig\s*\(\s*['"]([^'"]+)['"]/);
    if (savefigMatch) return savefigMatch[1].split('/').pop() || savefigMatch[1];

    const readMatch = code.match(/pd\.read_(?:csv|excel)\s*\(\s*['"]([^'"]+)['"]/);
    if (readMatch) {
      const srcName = (readMatch[1].split('/').pop() || readMatch[1]).replace(/\.[^.]+$/, '');
      return `analyze_${srcName}.py`;
    }

    const defMatch = code.match(/def\s+(\w+)\s*\(/);
    if (defMatch) return `${defMatch[1]}.py`;

    const classMatch = code.match(/class\s+(\w+)/);
    if (classMatch) return `${classMatch[1]}.py`;

    if (/import\s+matplotlib|plt\./.test(code)) return `visualization_${index + 1}.py`;
    if (/sns\.|import\s+seaborn/.test(code)) return `chart_${index + 1}.py`;
    if (/pd\.|import\s+pandas/.test(code)) return `data_processing_${index + 1}.py`;

    const label = stepLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    return `${label}_${index}.py`;
  };

  const extractFileReferences = (text: string): Array<{ name: string; downloadable: boolean; size?: number }> => {
    const refs: Array<{ name: string; downloadable: boolean; size?: number }> = [];
    const filePattern = /[\w\-./]+\.(?:xlsx|xls|csv|py|json|txt|pdf|png|jpg|jpeg|html|md)/gi;
    const matches = text.match(filePattern) || [];
    const seen = new Set<string>();
    matches.forEach(m => {
      const name = m.split('/').pop() || m;
      const lower = name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        refs.push({ name, downloadable: true });
      }
    });
    return refs;
  };

  const downloadArtifact = async (artifact: Artifact) => {
    const triggerBlobDownload = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    switch (artifact.type) {
      case 'image': {
        const imgUrl =
          typeof artifact.content === 'string'
            ? artifact.content
            : artifact.content?.url || artifact.content?.src || String(artifact.content);
        const resolvedUrl = imgUrl.startsWith('/images/') ? `${process.env.API_BASE_URL || ''}${imgUrl}` : imgUrl;
        try {
          const resp = await fetch(resolvedUrl);
          const blob = await resp.blob();
          const filename = artifact.name || imgUrl.split('/').pop() || 'image.png';
          triggerBlobDownload(blob, filename);
        } catch {
          const a = document.createElement('a');
          a.href = resolvedUrl;
          a.download = artifact.name || 'image.png';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        break;
      }
      case 'html': {
        const htmlContent =
          typeof artifact.content === 'string'
            ? artifact.content
            : artifact.content?.content || artifact.content?.html || String(artifact.content);
        const blob = new Blob([htmlContent], { type: 'text/html' });
        triggerBlobDownload(blob, artifact.name || 'report.html');
        break;
      }
      case 'code': {
        const blob = new Blob([String(artifact.content)], { type: 'text/plain' });
        triggerBlobDownload(blob, artifact.name || 'code.py');
        break;
      }
      case 'table': {
        const rows = artifact.content?.rows || [];
        const columns = artifact.content?.columns?.map((c: any) => c.dataIndex || c.key || c) || [];
        const csvContent = [
          columns.join(','),
          ...rows.map((row: any) => columns.map((col: string) => JSON.stringify(row[col] ?? '')).join(',')),
        ].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        triggerBlobDownload(blob, artifact.name?.replace(/\.\w+$/, '.csv') || 'table.csv');
        break;
      }
      case 'markdown':
      case 'summary': {
        const blob = new Blob([String(artifact.content)], { type: 'text/markdown' });
        triggerBlobDownload(blob, artifact.name || `${artifact.type}.md`);
        break;
      }
      case 'file': {
        const filePath = artifact.content?.file_path || artifact.content?.path;
        if (filePath && filePath.includes('/images/')) {
          const imgName = filePath.split('/').pop();
          const resolvedUrl = `${process.env.API_BASE_URL || ''}/images/${imgName}`;
          try {
            const resp = await fetch(resolvedUrl);
            const blob = await resp.blob();
            triggerBlobDownload(blob, artifact.name || imgName || 'file');
          } catch {
            message.warning('文件暂不可下载');
          }
        } else {
          message.warning('文件暂不可下载');
        }
        break;
      }
      default: {
        const blob = new Blob([JSON.stringify(artifact.content, null, 2)], { type: 'application/json' });
        triggerBlobDownload(blob, artifact.name || 'artifact.json');
      }
    }
  };

  const _copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('Copied to clipboard');
    });
  };

  const _getArtifactIcon = (type: ArtifactType, chartType?: ChartType) => {
    switch (type) {
      case 'table':
        return <TableOutlined className='text-blue-500' />;
      case 'chart':
        if (chartType === 'pie' || chartType === 'donut') {
          return <PieChartOutlined className='text-green-500' />;
        }
        return <BarChartOutlined className='text-green-500' />;
      case 'code':
        return <CodeOutlined className='text-purple-500' />;
      case 'image':
        return <FileImageOutlined className='text-pink-500' />;
      case 'markdown':
        return <FileTextOutlined className='text-orange-500' />;
      case 'summary':
        return <FileTextOutlined className='text-emerald-500' />;
      case 'file':
        return <FileOutlined className='text-gray-500' />;
      default:
        return <FileOutlined className='text-gray-500' />;
    }
  };

  // Build artifacts from execution data — shared between live streaming and history restore
  const buildArtifactsFromExecution = (
    messageId: string,
    execution: {
      steps: ExecutionStep[];
      outputs: Record<string, ExecutionOutput[]>;
    },
    summaryText?: string,
    filePath?: string | null,
  ): Artifact[] => {
    const finalArtifacts: Artifact[] = [];
    const now = Date.now();
    const seenCodeHashes = new Set<string>();

    if (execution) {
      const allSteps = execution.steps || [];
      allSteps.forEach(step => {
        const stepOutputs = execution.outputs[step.id] || [];
        stepOutputs.forEach((output, oIdx) => {
          if (output.output_type === 'code') {
            const codeStr = String(output.content || '').trim();
            const hash = codeStr.slice(0, 200);
            if (codeStr && !seenCodeHashes.has(hash)) {
              seenCodeHashes.add(hash);
              const fileName = extractCodeFileName(codeStr, (step as any).action || step.id, oIdx);
              finalArtifacts.push({
                id: `${messageId}-code-${step.id}-${oIdx}`,
                type: 'code',
                name: fileName,
                content: codeStr,
                createdAt: now,
                messageId,
                stepId: step.id,
                downloadable: true,
              });
            }
          } else if (output.output_type === 'file') {
            finalArtifacts.push({
              id: `${messageId}-file-${step.id}-${oIdx}`,
              type: 'file',
              name: output.content?.name || output.content?.file_name || 'File',
              content: output.content,
              createdAt: now,
              messageId,
              stepId: step.id,
              downloadable: true,
              size: output.content?.size,
            });
          } else if (output.output_type === 'html') {
            const htmlContent =
              typeof output.content === 'string'
                ? output.content
                : output.content?.content || output.content?.html || String(output.content);
            const htmlTitle = output.content?.title || 'Report';
            finalArtifacts.push({
              id: `${messageId}-html-${step.id}-${oIdx}`,
              type: 'html',
              name: `${htmlTitle}.html`,
              content: htmlContent,
              createdAt: now,
              messageId,
              stepId: step.id,
              downloadable: true,
            });
          } else if (output.output_type === 'image') {
            const imgUrl =
              typeof output.content === 'string'
                ? output.content
                : output.content?.url || output.content?.src || String(output.content);
            const imgName = imgUrl.split('/').pop() || `image_${oIdx}.png`;
            const displayName = imgName.replace(/^[a-f0-9]{8}_/, '');
            finalArtifacts.push({
              id: `${messageId}-img-${step.id}-${oIdx}`,
              type: 'image',
              name: displayName,
              content: imgUrl,
              createdAt: now,
              messageId,
              stepId: step.id,
              downloadable: true,
            });
          }
        });
      });
    }

    if (summaryText) {
      const fileRefs = extractFileReferences(summaryText);
      fileRefs.forEach((ref, idx) => {
        const alreadyExists = finalArtifacts.some(a => a.name.toLowerCase() === ref.name.toLowerCase());
        if (!alreadyExists) {
          finalArtifacts.push({
            id: `${messageId}-fileref-${idx}`,
            type: 'file',
            name: ref.name,
            content: { name: ref.name },
            createdAt: now,
            messageId,
            downloadable: ref.downloadable,
            size: ref.size,
          });
        }
      });
    }

    if (filePath) {
      const uploadName = filePath.split('/').pop() || 'uploaded_file';
      const alreadyExists = finalArtifacts.some(a => a.name.toLowerCase() === uploadName.toLowerCase());
      if (!alreadyExists) {
        finalArtifacts.push({
          id: `${messageId}-upload`,
          type: 'file',
          name: uploadName,
          content: { name: uploadName, file_path: filePath },
          createdAt: now,
          messageId,
          downloadable: true,
        });
      }
    }

    // Deduplicate: for artifacts with the same name+type, keep only the last one
    const deduped: Artifact[] = [];
    const seen = new Map<string, number>();
    for (let i = finalArtifacts.length - 1; i >= 0; i--) {
      const key = `${finalArtifacts[i].type}:${finalArtifacts[i].name}`;
      if (!seen.has(key)) {
        seen.set(key, i);
        deduped.unshift(finalArtifacts[i]);
      }
    }

    return deduped;
  };

  const handleStart = async (inputQuery = query, overrideFile?: File | null, overrideSkill?: Skill | null) => {
    const effectiveFile = overrideFile !== undefined ? overrideFile : uploadedFile;
    const effectiveSkill = overrideSkill !== undefined ? overrideSkill : selectedSkill;
    if ((!inputQuery.trim() && !effectiveFile) || loading) return;

    let finalQuery = inputQuery;
    const appCode = 'chat_normal';
    const chatMode = 'chat_normal';
    let currentUploadedFilePath = null;

    // Handle File Upload if present
    if (preloadedFilePathRef.current) {
      // Example file already copied to server - skip upload
      currentUploadedFilePath = preloadedFilePathRef.current;
      setUploadedFilePath(currentUploadedFilePath);
      preloadedFilePathRef.current = null;
      finalQuery = inputQuery || 'Analyze the uploaded file.';
    } else if (effectiveFile) {
      const formData = new FormData();
      formData.append('file', effectiveFile);

      try {
        const uploadRes = await axios.post(`${process.env.API_BASE_URL ?? ''}/api/v1/python/file/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const resData = uploadRes.data;
        // Handle both wrapped Result {success, data} and raw string path
        if (resData?.success && resData?.data) {
          currentUploadedFilePath = resData.data;
          setUploadedFilePath(currentUploadedFilePath);
          finalQuery = inputQuery || 'Analyze the uploaded Excel file.';
        } else if (typeof resData === 'string' && resData.length > 0) {
          // Backend returned the file path directly as a string
          currentUploadedFilePath = resData;
          setUploadedFilePath(currentUploadedFilePath);
          finalQuery = inputQuery || 'Analyze the uploaded Excel file.';
        } else {
          const errMsg = resData?.err_msg || resData?.message || 'Unknown error';
          message.error('File upload failed: ' + errMsg);
          return;
        }
      } catch (uploadErr: any) {
        console.error('[Upload] error:', uploadErr);
        const errDetail =
          uploadErr?.response?.data?.err_msg ||
          uploadErr?.response?.data?.message ||
          uploadErr?.message ||
          'Network error';
        message.error('File upload failed: ' + errDetail);
        return;
      }
    } else {
      if (uploadedFilePath) {
        setUploadedFilePath(null);
        setFilePreview(null);
      }
      // Construct context prefix for non-file queries
      const contextParts = [];
      if (selectedDb) contextParts.push(`[Database: ${selectedDb.db_name}]`);
      if (selectedKnowledge) contextParts.push(`[Knowledge: ${selectedKnowledge.name}]`);
      if (contextParts.length > 0) {
        finalQuery = `${contextParts.join(' ')} ${inputQuery}`;
      }
    }

    // Prepare conversation ID
    const currentConvId = conversationId || generateUUID();
    if (!conversationId) {
      setConversationId(currentConvId);
    }

    // Calculate current order
    const currentOrder = Math.floor(messages.length / 2) + 1;

    const responseId = generateUUID();

    const humanId = generateUUID();

    // Add user message and AI placeholder message
    setMessages(prev => [
      ...prev,
      {
        id: humanId,
        role: 'human',
        context: inputQuery,
        order: currentOrder,
        attachedFile: effectiveFile
          ? {
              name: effectiveFile.name,
              size: effectiveFile.size,
              type: effectiveFile.type,
            }
          : undefined,
        attachedKnowledge: selectedKnowledge ?? undefined,
        attachedSkill: effectiveSkill ? { name: effectiveSkill.name, id: effectiveSkill.id } : undefined,
        attachedDb: selectedDb ? { db_name: selectedDb.db_name, db_type: selectedDb.db_type } : undefined,
      },
      {
        id: responseId,
        role: 'view',
        context: '',
        order: currentOrder,
        thinking: true,
      },
    ]);

    setLoading(true);
    setQuery(''); // Clear input
    setStreamingSummary('');
    setActiveViewMsgId(responseId); // Auto-switch right panel to new round

    const controller = new AbortController();
    terminatedStepIdsRef.current.clear();
    setExecutionMap(prev => ({
      ...prev,
      [responseId]: {
        steps: [],
        outputs: {},
        activeStepId: null,
        collapsed: false,
        stepThoughts: {},
      },
    }));
    setActiveMessageId(responseId);

    try {
      const response = await fetch(`${process.env.API_BASE_URL ?? ''}/api/v1/chat/react-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conv_uid: currentConvId,
          chat_mode: chatMode,
          model_name: model,
          user_input: finalQuery,
          temperature: 0.6,
          max_new_tokens: 4000,
          select_param: appCode === 'chat_normal' ? '' : appCode,
          ext_info: {
            ...(currentUploadedFilePath ? { file_path: currentUploadedFilePath } : {}),
            ...(effectiveSkill ? { skill_id: effectiveSkill.id, skill_name: effectiveSkill.name } : {}),
            ...(selectedDb ? { database_name: selectedDb.db_name, database_type: selectedDb.db_type } : {}),
            ...(selectedKnowledge
              ? { knowledge_space_name: selectedKnowledge.name, knowledge_space_id: selectedKnowledge.id }
              : {}),
          },
        }),
        signal: controller.signal,
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const processEvent = (raw: string) => {
        if (!raw.startsWith('data:')) return;
        const data = raw.slice(5).trim();
        if (!data) return;
        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch (_err) {
          return;
        }
        if (payload.type === 'step.start') {
          const id = payload.id || `${payload.step}`;
          if (terminatedStepIdsRef.current.has(id)) return;
          setExecutionMap(prev => {
            const current = prev[responseId] || {
              steps: [],
              outputs: {},
              activeStepId: null,
              collapsed: false,
              stepThoughts: {},
            };
            const existingThoughts = current.stepThoughts || {};
            const nextThoughts = existingThoughts;
            // Check if step already exists - if so, update it (especially phase) instead of creating duplicate
            const existingStepIndex = current.steps.findIndex(s => s.id === id);
            let nextSteps;
            if (existingStepIndex >= 0) {
              // Update existing step with new title/phase
              nextSteps = current.steps.map((step, idx) =>
                idx === existingStepIndex
                  ? { ...step, title: payload.title, detail: payload.detail, phase: payload.phase, status: 'running' as const }
                  : step.status === 'running' ? { ...step, status: 'done' } : step
              );
            } else {
              // New step - mark running steps as done and add new step
              nextSteps = [
                ...current.steps.map(item => (item.status === 'running' ? { ...item, status: 'done' } : item)),
                { id, step: payload.step, title: payload.title, detail: payload.detail, phase: payload.phase, status: 'running' as const },
              ];
            }
            return {
              ...prev,
              [responseId]: {
                ...current,
                steps: nextSteps,
                outputs: { ...current.outputs, [id]: current.outputs[id] || [] },
                stepThoughts: nextThoughts,
                activeStepId: id,
              },
            };
          });
          setActiveMessageId(responseId);
          setRightPanelCollapsed(false);
        } else if (payload.type === 'step.meta') {
          if (payload.action && payload.action.toLowerCase() === 'terminate') {
            terminatedStepIdsRef.current.add(payload.id);
            setExecutionMap(prev => {
              const current = prev[responseId];
              if (!current) return prev;
              const nextSteps = current.steps.filter(item => item.id !== payload.id);
              const nextActiveStepId = current.activeStepId === payload.id ? null : current.activeStepId;
              return {
                ...prev,
                [responseId]: { ...current, steps: nextSteps, activeStepId: nextActiveStepId },
              };
            });
            return;
          }
          setExecutionMap(prev => {
            const current = prev[responseId];
            if (!current) return prev;
            // Build detail from action only (thought goes to stepThoughts)
            const nextSteps = current.steps.map(item => {
              if (item.id !== payload.id) return item;
              const parts = [] as string[];
              if (payload.action) {
                parts.push(`Action: ${payload.action}`);
                if (payload.action !== 'code_interpreter' && payload.action_input) {
                  parts.push(`Action Input: ${payload.action_input}`);
                }
              }
              return {
                ...item,
                title: payload.title || item.title,
                detail: parts.join('\n') || item.detail,
              };
            });
            // Route thought to stepThoughts map for subtle display
            const nextThoughts = payload.thought
              ? {
                  ...current.stepThoughts,
                  [payload.id]: payload.thought,
                }
              : current.stepThoughts;
            return {
              ...prev,
              [responseId]: { ...current, steps: nextSteps, stepThoughts: nextThoughts },
            };
          });
        } else if (payload.type === 'step.output') {
          if (terminatedStepIdsRef.current.has(payload.id || '')) return;
          setExecutionMap(prev => {
            const current = prev[responseId];
            if (!current) return prev;
            const targetId = current.activeStepId;
            if (!targetId) return prev;
            const nextSteps = current.steps.map(item => {
              if (item.id !== targetId) return item;
              const detail = `${item.detail}\n${payload.detail}`.trim();
              return { ...item, detail };
            });
            return { ...prev, [responseId]: { ...current, steps: nextSteps } };
          });
        } else if (payload.type === 'step.chunk') {
          const id = payload.id;
          if (terminatedStepIdsRef.current.has(id || '')) return;
          setExecutionMap(prev => {
            const current = prev[responseId];
            if (!current) return prev;
            const targetId = id || current.activeStepId;
            if (!targetId) return prev;
            const list = current.outputs[targetId] ? [...current.outputs[targetId]] : [];
            list.push({ output_type: payload.output_type, content: payload.content });
            return {
              ...prev,
              [responseId]: {
                ...current,
                outputs: { ...current.outputs, [targetId]: list },
              },
            };
          });

          // Artifacts are now generated at task completion (final event),
          // not during streaming — to avoid showing intermediate outputs as artifacts
        } else if (payload.type === 'step.done') {
          const id = payload.id;
          if (terminatedStepIdsRef.current.has(id || '')) return;
          setExecutionMap(prev => {
            const current = prev[responseId];
            if (!current) return prev;
            const targetId = id || current.activeStepId;
            if (!targetId) return prev;
            const nextSteps = current.steps.map(item =>
              item.id === targetId ? { ...item, status: payload.status || 'done' } : item,
            );
            return { ...prev, [responseId]: { ...current, steps: nextSteps } };
          });
        } else if (payload.type === 'step.thought') {
          const content = payload.content || '';
          if (content) {
            setExecutionMap(prev => {
              const current = prev[responseId];
              if (!current) return prev;
              const targetId = payload.id || current.activeStepId || 'initial';
              return {
                ...prev,
                [responseId]: {
                  ...current,
                  stepThoughts: {
                    ...current.stepThoughts,
                    [targetId]: (current.stepThoughts?.[targetId] || '') + content,
                  },
                },
              };
            });
          }
        } else if (payload.type === 'final') {
          setExecutionMap(prev => {
            const current = prev[responseId];
            if (!current) return prev;
            const nextSteps = current.steps.map(item =>
              item.status === 'running' ? { ...item, status: 'done' } : item,
            );
            return { ...prev, [responseId]: { ...current, steps: nextSteps } };
          });
          setMessages(prev =>
            prev.map(msg => {
              if (msg.id !== responseId || msg.role !== 'view') return msg;
              return { ...msg, context: cleanFinalContent(payload.content || ''), thinking: false };
            }),
          );
          setActiveMessageId(responseId);

          if (payload.content) {
            setStreamingSummary('');
            setSummaryComplete(false);
            setRightPanelTab('summary');

            const summaryText = cleanFinalContent(payload.content);
            let index = 0;
            const streamInterval = setInterval(() => {
              if (index < summaryText.length) {
                const chunkSize = Math.min(3, summaryText.length - index);
                setStreamingSummary(prev => prev + summaryText.slice(index, index + chunkSize));
                index += chunkSize;
              } else {
                clearInterval(streamInterval);
                setSummaryComplete(true);

                setExecutionMap(currentExecMap => {
                  const execution = currentExecMap[responseId];
                  const deduped = buildArtifactsFromExecution(
                    responseId,
                    execution || { steps: [], outputs: {} },
                    summaryText,
                    uploadedFilePath,
                  );

                  setArtifacts(prev => {
                    const filtered = prev.filter(a => a.messageId !== responseId);
                    const newArtifacts = [...filtered, ...deduped];

                    // Auto-select the first HTML artifact for preview
                    const htmlArtifact = deduped.find(a => a.type === 'html');
                    if (htmlArtifact) {
                      setPreviewArtifact(htmlArtifact as Artifact);
                      setRightPanelView('html-preview');
                      setRightPanelCollapsed(false);
                    }

                    return newArtifacts;
                  });

                  return currentExecMap;
                });
              }
            }, 15);
          }
        } else if (payload.type === 'done') {
          setLoading(false);
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        parts.forEach(processEvent);
      }
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      message.error(err?.message || 'Failed to get response');
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg && lastMsg.role === 'view') {
          lastMsg.context = err?.message || 'Error occurred';
          lastMsg.thinking = false;
        }
        return newMessages;
      });
    }
  };

  const handleExampleClick = async (example: (typeof EXAMPLE_CARDS)[number]) => {
    if (loading) return;

    try {
      message.loading({ content: '正在加载示例...', key: 'example-loading', duration: 0 });

      const res = await axios.post(`${process.env.API_BASE_URL ?? ''}/api/v1/examples/use`, {
        example_id: example.id,
      });

      message.destroy('example-loading');

      if (res?.success && res?.data) {
        const filePath = res.data;
        preloadedFilePathRef.current = filePath;

        const fakeFile = new File([new ArrayBuffer(example.fileSize || 0)], example.fileName, {
          type: example.fileType,
        });
        setUploadedFile(fakeFile);

        // Auto-select skill if example specifies one
        let exampleSkill: Skill | null = null;
        if (example.skillName && skillsList) {
          const matched = skillsList.find(s => s.name === example.skillName);
          if (matched) {
            exampleSkill = matched;
            setSelectedSkill(matched);
          }
        }

        handleStart(example.query, fakeFile, exampleSkill);
      } else {
        const errMsg = res?.err_msg || 'Unknown error';
        message.error('加载示例失败: ' + errMsg);
      }
    } catch (err: unknown) {
      message.destroy('example-loading');
      console.error('Example click error:', err);
      const errMessage = err instanceof Error ? err.message : 'Unknown error';
      message.error('加载示例失败: ' + errMessage);
    }
  };

  // Clear chat history
  const handleClearChat = () => {
    setMessages([]);
    setConversationId(null);
    setQuery('');
    setExecutionMap({});
    setActiveMessageId(null);
    setActiveViewMsgId(null);
    setUploadedFilePath(null);
    setFilePreview(null);
    setFilePreviewError(null);
    setArtifacts([]);
    setRightPanelTab('preview');
    setStreamingSummary('');
    setSummaryComplete(false);
    router.push('/', undefined, { shallow: true });
  };

  const restoreFromHistory = (
    historyMessages: Array<{ role: string; context: string; order?: number; model_name?: string }>,
  ) => {
    setExecutionMap({});
    setActiveMessageId(null);
    setActiveViewMsgId(null);
    setArtifacts([]);
    setStreamingSummary('');
    setSummaryComplete(false);

    const newMessages: ChatMessage[] = [];
    const newExecutionMap: typeof executionMap = {};
    const allArtifacts: Artifact[] = [];

    historyMessages.forEach(msg => {
      if (msg.role === 'human') {
        newMessages.push({ id: generateUUID(), role: 'human', context: msg.context, order: msg.order });
      } else if (msg.role === 'view') {
        const viewId = generateUUID();
        let payload: any = null;
        try {
          payload = JSON.parse(msg.context);
        } catch {
          /* ignore parse failure */
        }

        if (payload && payload.version === 1 && payload.type === 'react-agent') {
          const steps: ExecutionStep[] = (payload.steps || []).map((s: any, idx: number) => ({
            id: s.id || `history-step-${idx}`,
            step: idx + 1,
            title: s.title || s.action || `Step ${idx + 1}`,
            detail: s.detail || '',
            status: (s.status === 'failed' ? 'failed' : 'done') as 'done' | 'failed',
          }));

          const outputs: Record<string, ExecutionOutput[]> = {};
          const stepThoughts: Record<string, string> = {};

          (payload.steps || []).forEach((s: any, idx: number) => {
            const stepId = s.id || `history-step-${idx}`;
            if (Array.isArray(s.outputs)) {
              outputs[stepId] = s.outputs.map((o: any) => ({
                output_type: o.output_type || 'text',
                content: o.content,
              }));
            }
            if (s.action === 'code_interpreter' && s.action_input) {
              const existingOutputs = outputs[stepId] || [];
              const hasCode = existingOutputs.some((o: ExecutionOutput) => o.output_type === 'code');
              if (!hasCode) {
                try {
                  const input = typeof s.action_input === 'string' ? JSON.parse(s.action_input) : s.action_input;
                  if (input && input.code) {
                    outputs[stepId] = [{ output_type: 'code', content: input.code }, ...existingOutputs];
                  }
                } catch {
                  /* ignore */
                }
              }
            }
            if (s.thought) {
              stepThoughts[stepId] = s.thought;
            }
          });

          newExecutionMap[viewId] = {
            steps,
            outputs,
            activeStepId: steps.length > 0 ? steps[steps.length - 1].id : null,
            collapsed: false,
            stepThoughts,
          };

          const finalContent = cleanFinalContent(payload.final_content || '');

          const restoredArtifacts = buildArtifactsFromExecution(viewId, { steps, outputs }, finalContent, null);
          allArtifacts.push(...restoredArtifacts);

          newMessages.push({
            id: viewId,
            role: 'view',
            context: finalContent,
            order: msg.order,
            thinking: false,
          });
        } else {
          newMessages.push({
            id: viewId,
            role: 'view',
            context: msg.context || '',
            order: msg.order,
            thinking: false,
          });
        }
      }
    });

    setMessages(newMessages);
    setExecutionMap(newExecutionMap);
    setArtifacts(allArtifacts);

    const lastView = [...newMessages].reverse().find(m => m.role === 'view');
    if (lastView?.id) {
      setActiveMessageId(lastView.id);
      setStreamingSummary(lastView.context || '');
      setSummaryComplete(true);
    }
  };

  const loadConversation = async (convUid: string) => {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const res: any = await axios.get(`/api/v1/chat/dialogue/messages/history?con_uid=${convUid}`);
      let msgList: any[] | null = null;
      if (res?.success && Array.isArray(res.data)) {
        msgList = res.data;
      } else if (Array.isArray(res?.data?.data)) {
        msgList = res.data.data;
      } else if (Array.isArray(res?.data)) {
        msgList = res.data;
      } else if (Array.isArray(res)) {
        msgList = res;
      }
      if (msgList && msgList.length > 0) {
        setConversationId(convUid);
        restoreFromHistory(
          msgList.map((m: any) => ({
            role: m.role,
            context: m.context,
            order: m.order,
            model_name: m.model_name,
          })),
        );
      }
    } catch (e) {
      console.error('Failed to load conversation', e);
      message.error('加载历史对话失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const _QuickAction = ({ icon, text, onClick }: { icon: any; text: string; onClick?: () => void }) => (
    <div
      onClick={onClick}
      className='flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#2c2d31] border border-gray-200 dark:border-gray-700 rounded-full cursor-pointer hover:bg-gray-50 dark:hover:bg-[#35363a] transition-colors text-sm text-gray-600 dark:text-gray-300 shadow-sm'
    >
      {icon}
      <span>{text}</span>
    </div>
  );

  const getDbIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('mysql')) return <ConsoleSqlOutlined className='text-blue-500' />;
    if (lowerType.includes('postgre')) return <DatabaseOutlined className='text-blue-400' />;
    if (lowerType.includes('mongo')) return <CloudServerOutlined className='text-green-500' />;
    if (lowerType.includes('sqlite')) return <DatabaseOutlined className='text-amber-500' />;
    return <DatabaseOutlined className='text-gray-500' />;
  };

  // Upload Props
  const uploadProps: any = {
    name: 'file',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file: any) => {
      setUploadedFile(file);
      parseLocalFilePreview(file as File);
      message.success(`${file.name} attached successfully`);
      return false; // Prevent auto upload, we just want to select it
    },
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#000000',
        },
      }}
    >
      <div className='flex h-full w-full bg-[#f7f7f9] dark:bg-[#0f1012] text-[#1a1b1e] dark:text-gray-200 font-sans overflow-hidden'>
        {/* Main Content */}
        <div className='flex-1 flex flex-col relative bg-white dark:bg-[#111217]'>
          {/* Top Header */}
          <div className='h-16 flex items-center justify-between px-8 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#111217]/80 backdrop-blur sticky top-0 z-20'>
            <div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 px-2 py-1 rounded-md'>
              <span>DB-GPT</span>
            </div>
            <div className='flex items-center gap-4'>
              {selectedDb && (
                <Tag className='flex items-center gap-1 bg-blue-50 border-blue-200 text-blue-700 px-3 py-1 rounded-full text-xs'>
                  {getDbIcon(selectedDb.type)} <span className='font-medium ml-1'>{selectedDb.db_name}</span>
                </Tag>
              )}
              {messages.length > 0 && (
                <Button type='text' size='small' onClick={handleClearChat} className='text-gray-500'>
                  Clear Chat
                </Button>
              )}
              <BellOutlined className='text-lg text-gray-500 cursor-pointer' />
              <div className='flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full text-xs font-medium'>
                <ThunderboltOutlined className='text-yellow-500' /> <span>300</span>
              </div>
              <Avatar size='small' icon={<UserOutlined />} className='bg-blue-500' />
            </div>
          </div>

          {/* Chat Messages or Hero Section */}
          {messages.length > 0 ? (
            <div className='flex-1 flex overflow-hidden justify-center'>
              <div
                className={`${rightPanelCollapsed ? 'max-w-[800px] w-full border-r-0' : 'w-[40%] min-w-[400px] border-r border-gray-200/80 dark:border-gray-800'} flex flex-col overflow-hidden bg-white dark:bg-[#111217] transition-all duration-300 relative`}
              >
                <div className='flex-1 overflow-y-auto'>
                  {rounds.map((round, roundIndex) => {
                    const isLastRound = roundIndex === rounds.length - 1;
                    const isSelected = round.viewMsg?.id === selectedViewMsgId;
                    const isCurrentRoundCollapsed = !isLastRound && !isSelected;

                    const execution = round.viewMsg?.id ? executionMap[round.viewMsg.id] : undefined;
                    const {
                      sections,
                      activeStep: _activeStep,
                      outputs: _outputs,
                      stepThoughts,
                    } = convertToManusFormat(execution, round.humanMsg?.context);
                    const isWorking =
                      (isLastRound &&
                        (round.viewMsg?.thinking || execution?.steps.some(s => s.status === 'running'))) ||
                      false;

                    const roundAssistantText = isLastRound
                      ? streamingSummary || round.viewMsg?.context || undefined
                      : round.viewMsg?.context || undefined;

                    return (
                      <ManusLeftPanel
                        key={round.viewMsg?.id || round.humanMsg?.id || `round-${roundIndex}`}
                        sections={sections}
                        activeStepId={isSelected ? selectedStepId || execution?.activeStepId : undefined}
                        onStepClick={(stepId, _sectionId) => {
                          if (round.viewMsg?.id) {
                            setActiveViewMsgId(round.viewMsg.id);
                            setSelectedStepId(stepId);
                            setExecutionMap(prev => ({
                              ...prev,
                              [round.viewMsg!.id!]: {
                                ...prev[round.viewMsg!.id!],
                                activeStepId: stepId,
                              },
                            }));
                          }
                        }}
                        isWorking={isWorking}
                        userQuery={round.humanMsg?.context}
                        attachedFile={round.humanMsg?.attachedFile}
                        attachedKnowledge={round.humanMsg?.attachedKnowledge}
                        attachedSkill={round.humanMsg?.attachedSkill}
                        attachedDb={round.humanMsg?.attachedDb}
                        assistantText={roundAssistantText}
                        modelName={round.viewMsg?.model_name || model}
                        stepThoughts={stepThoughts}
                        artifacts={artifacts.filter(a => a.messageId === round.viewMsg?.id)}
                        onArtifactClick={artifact => {
                          if (round.viewMsg?.id) setActiveViewMsgId(round.viewMsg.id);
                          setRightPanelCollapsed(false);
                          if (artifact.type === 'html') {
                            setPreviewArtifact(artifact as Artifact);
                            setRightPanelView('html-preview');
                          } else if (artifact.type === 'code' && artifact.stepId) {
                            setSelectedStepId(artifact.stepId);
                            setRightPanelView('execution');
                            if (round.viewMsg?.id && execution) {
                              setExecutionMap(prev => ({
                                ...prev,
                                [round.viewMsg!.id!]: {
                                  ...prev[round.viewMsg!.id!],
                                  activeStepId: artifact.stepId!,
                                },
                              }));
                            }
                          }
                        }}
                        onArtifactDownload={artifact => downloadArtifact(artifact as Artifact)}
                        onViewAllFiles={() => {
                          if (round.viewMsg?.id) setActiveViewMsgId(round.viewMsg.id);
                          setRightPanelCollapsed(false);
                          setRightPanelView('files');
                        }}
                        isCollapsed={isCurrentRoundCollapsed}
                        onExpand={() => {
                          if (round.viewMsg?.id) setActiveViewMsgId(round.viewMsg.id);
                        }}
                      />
                    );
                  })}
                </div>

                {/* Input Area at Bottom for Chat Mode */}
                <div className='border-t border-gray-200/80 dark:border-gray-800 bg-white/90 dark:bg-[#1a1b1e] p-4 md:p-6'>
                  <div className='max-w-[720px] mx-auto'>
                    {/* Context Tags Area */}
                    <div className='flex flex-wrap gap-2 mb-2'>
                      {selectedDb && (
                        <Tag
                          closable
                          onClose={() => setSelectedDb(null)}
                          className='flex items-center gap-1 bg-blue-50 border-blue-200 text-blue-700 px-3 py-1 rounded-full'
                        >
                          {getDbIcon(selectedDb.type)} <span className='font-medium ml-1'>{selectedDb.db_name}</span>
                        </Tag>
                      )}
                      {selectedKnowledge && (
                        <Tag
                          closable
                          onClose={() => setSelectedKnowledge(null)}
                          className='flex items-center gap-1 bg-orange-50 border-orange-200 text-orange-700 px-3 py-1 rounded-full'
                        >
                          <BookOutlined /> <span className='font-medium ml-1'>{selectedKnowledge.name}</span>
                        </Tag>
                      )}
                      {uploadedFile && (
                        <Tag
                          closable
                          onClose={() => setUploadedFile(null)}
                          className='flex items-center gap-1 bg-green-50 border-green-200 text-green-700 px-3 py-1 rounded-full'
                        >
                          <FileExcelOutlined /> <span className='font-medium ml-1'>{uploadedFile.name}</span>
                        </Tag>
                      )}
                    </div>

                    <div className='flex gap-2'>
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'upload',
                              label: (
                                <Upload {...uploadProps}>
                                  <div className='w-full'>Upload File</div>
                                </Upload>
                              ),
                              icon: <UploadOutlined />,
                            },
                            {
                              key: 'database',
                              label: 'Select Data Source',
                              icon: <DatabaseOutlined />,
                              onClick: () => setIsDbModalOpen(true),
                            },
                            {
                              key: 'knowledge',
                              label: 'Select Knowledge Base',
                              icon: <BookOutlined />,
                              onClick: () => setIsKnowledgeModalOpen(true),
                            },
                          ],
                        }}
                        trigger={['click']}
                      >
                        <Tooltip title='Add Context (File, DB, Knowledge)'>
                          <Button
                            type='text'
                            shape='circle'
                            icon={<PlusOutlined />}
                            className='text-gray-500 hover:bg-gray-100 flex-shrink-0'
                          />
                        </Tooltip>
                      </Dropdown>

                      {/* Skill Selector Button with Badge */}
                      <Popover
                        trigger='click'
                        placement='topLeft'
                        open={isSkillPanelOpen}
                        onOpenChange={setIsSkillPanelOpen}
                        overlayClassName='manus-skill-menu'
                        overlayInnerStyle={{ padding: 0, borderRadius: 12 }}
                        content={
                          <div className='w-[320px] bg-white dark:bg-[#2c2d31] rounded-xl shadow-xl overflow-hidden'>
                            {/* Search Input */}
                            <div className='p-3 border-b border-gray-100 dark:border-gray-700'>
                              <Input
                                placeholder={t('search_skill') || '搜索技能'}
                                prefix={<SearchOutlined className='text-gray-400' />}
                                value={skillSearchQuery}
                                onChange={e => setSkillSearchQuery(e.target.value)}
                                className='rounded-lg'
                                allowClear
                                size='small'
                              />
                            </div>

                            {/* Skills List */}
                            <div className='max-h-[300px] overflow-y-auto'>
                              {(skillsList || [])
                                .filter(
                                  skill =>
                                    !skillSearchQuery ||
                                    skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                                    skill.description.toLowerCase().includes(skillSearchQuery.toLowerCase()),
                                )
                                .map(skill => (
                                  <div
                                    key={skill.id}
                                    onClick={() => {
                                      setSelectedSkill(skill);
                                      setQuery(`/${skill.name} `);
                                      setIsSkillPanelOpen(false);
                                      setSkillSearchQuery('');
                                    }}
                                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                      selectedSkill?.id === skill.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                                    }`}
                                  >
                                    <div className='flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs'>
                                      {skill.icon || <ThunderboltOutlined />}
                                    </div>
                                    <div className='flex-1 min-w-0'>
                                      <div className='flex items-center gap-2'>
                                        <span className='font-medium text-sm text-gray-800 dark:text-gray-200'>
                                          {skill.name}
                                        </span>
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            skill.type === 'official'
                                              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                          }`}
                                        >
                                          {skill.type === 'official' ? '官方' : '个人'}
                                        </span>
                                      </div>
                                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2'>
                                        {skill.description}
                                      </p>
                                    </div>
                                    {selectedSkill?.id === skill.id && (
                                      <CheckCircleFilled className='text-purple-500 flex-shrink-0 text-sm' />
                                    )}
                                  </div>
                                ))}

                              {/* Empty State */}
                              {(skillsList || []).filter(
                                skill =>
                                  !skillSearchQuery ||
                                  skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                                  skill.description.toLowerCase().includes(skillSearchQuery.toLowerCase()),
                              ).length === 0 && (
                                <div className='text-center py-8 text-gray-400'>
                                  <ThunderboltOutlined className='text-2xl mb-2 opacity-50' />
                                  <div className='text-xs'>
                                    {skillSearchQuery ? '未找到匹配的技能' : '暂无可用技能'}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Footer */}
                            <div className='border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50'>
                              <span className='text-[10px] text-gray-400'>{(skillsList || []).length} 个技能可用</span>
                              <Button
                                type='link'
                                size='small'
                                onClick={() => {
                                  router.push('/construct/skills');
                                  setIsSkillPanelOpen(false);
                                }}
                                className='text-[10px] p-0 h-auto'
                              >
                                管理技能 →
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Tooltip title={selectedSkill ? `技能: ${selectedSkill.name}` : '选择技能'}>
                          <Button
                            type='text'
                            shape='circle'
                            className={`relative text-gray-500 hover:bg-gray-100 flex-shrink-0 ${selectedSkill ? 'bg-purple-50 text-purple-500' : ''}`}
                          >
                            <div className='relative'>
                              <ThunderboltOutlined className={selectedSkill ? 'text-purple-500' : ''} />
                              {selectedSkill && (
                                <span className='absolute -top-1 -right-1 bg-purple-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold'>
                                  1
                                </span>
                              )}
                            </div>
                          </Button>
                        </Tooltip>
                      </Popover>

                      <Input.TextArea
                        value={query}
                        onChange={e => {
                          const newValue = e.target.value;
                          setQuery(newValue);
                          if (newValue.startsWith('/') && !isSkillPanelOpen) {
                            setIsSkillPanelOpen(true);
                          }
                        }}
                        onPressEnter={e => {
                          if (!e.shiftKey) {
                            e.preventDefault();
                            handleStart();
                          }
                        }}
                        placeholder={
                          t('ask_data_question') ||
                          'Ask a question about your database, upload a CSV, or generate a report...'
                        }
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        className='flex-1 resize-none rounded-2xl bg-gray-50/80 dark:bg-[#121317] border border-gray-200/80 dark:border-gray-700 px-4 py-3 focus:border-gray-400 focus:ring-1 focus:ring-gray-300/60'
                      />

                      <Button
                        type='primary'
                        shape='circle'
                        icon={<ArrowUpOutlined />}
                        onClick={() => handleStart()}
                        disabled={!query.trim() && !uploadedFile}
                        loading={loading}
                        className={`${query.trim() || uploadedFile ? 'bg-black hover:bg-gray-800' : 'bg-gray-200 text-gray-400 hover:bg-gray-200'} border-none shadow-none flex-shrink-0 h-10 w-10`}
                      />
                    </div>

                    <ModelSelector onChange={val => setModel(val)} />
                  </div>
                </div>

                {rightPanelCollapsed && (
                  <div className='absolute right-0 top-1/2 -translate-y-1/2 z-10'>
                    <Tooltip title='展开面板'>
                      <Button
                        type='text'
                        shape='circle'
                        size='small'
                        icon={<RightOutlined />}
                        onClick={() => setRightPanelCollapsed(false)}
                        className='text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1b1e]'
                      />
                    </Tooltip>
                  </div>
                )}
              </div>
              <div
                className={`${rightPanelCollapsed ? 'w-0 min-w-0 overflow-hidden opacity-0' : 'w-[60%] min-w-[520px]'} bg-[#f8f8fb] dark:bg-[#0f1114] flex flex-col transition-all duration-300`}
              >
                {(() => {
                  const activeViewMsg = messages.find(m => m.id === selectedViewMsgId && m.role === 'view');
                  const execution = activeViewMsg?.id ? executionMap[activeViewMsg.id] : undefined;
                  const { activeStep, outputs, stepThoughts: _stepThoughts } = convertToManusFormat(execution);
                  const isRunning = execution?.steps.some(s => s.status === 'running') || false;

                  return (
                    <ManusRightPanel
                      activeStep={activeStep}
                      outputs={outputs}
                      databaseType={selectedDb?.db_type}
                      isRunning={isRunning}
                      onCollapse={() => setRightPanelCollapsed(true)}
                      onRerun={() => {}}
                      terminalTitle='DB-GPT 的电脑'
                      artifacts={artifacts.filter(a => a.messageId === activeViewMsg?.id)}
                      onArtifactClick={artifact => {
                        if (artifact.type === 'html') {
                          setPreviewArtifact(artifact as Artifact);
                          setRightPanelView('html-preview');
                        } else if (artifact.type === 'code' && artifact.stepId) {
                          setSelectedStepId(artifact.stepId);
                          setRightPanelView('execution');
                          if (activeViewMsg?.id && execution) {
                            setExecutionMap(prev => ({
                              ...prev,
                              [activeViewMsg.id!]: {
                                ...prev[activeViewMsg.id!],
                                activeStepId: artifact.stepId!,
                              },
                            }));
                          }
                        }
                      }}
                      panelView={rightPanelView}
                      onPanelViewChange={setRightPanelView}
                      previewArtifact={previewArtifact}
                    />
                  );
                })()}
              </div>
            </div>
          ) : (
            // Welcome Mode: Display Hero Section
            <div className='flex-1 flex flex-col items-center justify-center px-6 py-4 pb-20 overflow-y-auto'>
              <div className='w-full max-w-[860px] flex flex-col items-center animate-fade-in-up'>
                <div className='flex flex-col items-center mb-8'>
                  <div className='px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-xs font-semibold rounded-full'>
                    Intelligent Data Analysis Agent
                  </div>
                </div>

                <h1 className='text-4xl md:text-5xl font-serif text-gray-900 dark:text-gray-100 mb-12 text-center flex items-center gap-4'>
                  <div className='w-12 h-12 rounded-xl bg-white dark:bg-[#1a1b1e] shadow-md flex items-center justify-center flex-shrink-0'>
                    <Image src='/LOGO_SMALL.png' alt='DB-GPT' width={32} height={32} className='object-contain' />
                  </div>
                  Agentic Data Driven Decisions
                </h1>

                {/* Input Box Container */}
                <div className='w-full bg-white dark:bg-[#25262b] border border-gray-200 dark:border-gray-700 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-500 p-4 relative'>
                  {/* Uploaded File, Database, Knowledge Tags */}
                  {(uploadedFile || selectedDb || selectedKnowledge) && (
                    <div className='flex flex-wrap gap-2 mb-2'>
                      {uploadedFile && (
                        <Tag
                          closable
                          onClose={() => setUploadedFile(null)}
                          className='flex items-center gap-1 bg-green-50 border-green-200 text-green-700 px-3 py-1 rounded-full'
                        >
                          <FileExcelOutlined /> <span className='font-medium ml-1'>{uploadedFile.name}</span>
                        </Tag>
                      )}
                      {selectedDb && (
                        <Tag
                          closable
                          onClose={() => setSelectedDb(null)}
                          className='flex items-center gap-1 bg-blue-50 border-blue-200 text-blue-700 px-3 py-1 rounded-full'
                        >
                          {getDbIcon(selectedDb.type)} <span className='font-medium ml-1'>{selectedDb.db_name}</span>
                        </Tag>
                      )}
                      {selectedKnowledge && (
                        <Tag
                          closable
                          onClose={() => setSelectedKnowledge(null)}
                          className='flex items-center gap-1 bg-orange-50 border-orange-200 text-orange-700 px-3 py-1 rounded-full'
                        >
                          <BookOutlined /> <span className='font-medium ml-1'>{selectedKnowledge.name}</span>
                        </Tag>
                      )}
                    </div>
                  )}

                  <Input.TextArea
                    value={query}
                    onChange={e => {
                      const newValue = e.target.value;
                      setQuery(newValue);
                      if (newValue.startsWith('/') && !isSkillPanelOpen) {
                        setIsSkillPanelOpen(true);
                      }
                    }}
                    onPressEnter={e => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        handleStart();
                      }
                    }}
                    placeholder={
                      t('ask_data_question') ||
                      'Ask a question about your database, upload a CSV, or generate a report...'
                    }
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    className='text-lg resize-none !border-none !shadow-none !bg-transparent px-2 mb-4'
                    style={{ backgroundColor: 'transparent' }}
                  />

                  {/* Input Toolbar */}
                  <div className='flex items-center justify-between px-2'>
                    <div className='flex items-center gap-2'>
                      {/* Add Button with Dropdown Menu */}
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'upload',
                              label: (
                                <Upload {...uploadProps}>
                                  <div className='w-full'>从本地文件添加</div>
                                </Upload>
                              ),
                              icon: <FileOutlined />,
                            },
                            {
                              key: 'skill',
                              label: '使用技能',
                              icon: <ThunderboltOutlined />,
                              onClick: () => setIsSkillPanelOpen(true),
                            },
                            {
                              key: 'knowledge',
                              label: '使用知识库',
                              icon: <BookOutlined />,
                              onClick: () => setIsKnowledgePanelOpen(true),
                            },
                            {
                              key: 'database',
                              label: '使用数据库',
                              icon: <DatabaseOutlined />,
                              onClick: () => setTimeout(() => setIsDbPanelOpen(true), 100),
                            },
                          ],
                        }}
                        trigger={['click']}
                      >
                        <Tooltip title='添加'>
                          <Button
                            type='text'
                            shape='circle'
                            icon={<PlusOutlined />}
                            className='text-gray-500 hover:bg-gray-100'
                          />
                        </Tooltip>
                      </Dropdown>

                      {/* Skill Selector Button with Badge */}
                      <Popover
                        trigger='click'
                        placement='topLeft'
                        open={isSkillPanelOpen}
                        onOpenChange={setIsSkillPanelOpen}
                        overlayClassName='manus-skill-menu'
                        overlayInnerStyle={{ padding: 0, borderRadius: 12 }}
                        content={
                          <div className='w-[320px] bg-white dark:bg-[#2c2d31] rounded-xl shadow-xl overflow-hidden'>
                            {/* Search Input */}
                            <div className='p-3 border-b border-gray-100 dark:border-gray-700'>
                              <Input
                                placeholder={t('search_skill') || '搜索技能'}
                                prefix={<SearchOutlined className='text-gray-400' />}
                                value={skillSearchQuery}
                                onChange={e => setSkillSearchQuery(e.target.value)}
                                className='rounded-lg'
                                allowClear
                                size='small'
                              />
                            </div>

                            {/* Skills List */}
                            <div className='max-h-[300px] overflow-y-auto'>
                              {(skillsList || [])
                                .filter(
                                  skill =>
                                    !skillSearchQuery ||
                                    skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                                    skill.description.toLowerCase().includes(skillSearchQuery.toLowerCase()),
                                )
                                .map(skill => (
                                  <div
                                    key={skill.id}
                                    onClick={() => {
                                      setSelectedSkill(skill);
                                      setQuery(`/${skill.name} `);
                                      setIsSkillPanelOpen(false);
                                      setSkillSearchQuery('');
                                    }}
                                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                      selectedSkill?.id === skill.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                                    }`}
                                  >
                                    <div className='flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs'>
                                      {skill.icon || <ThunderboltOutlined />}
                                    </div>
                                    <div className='flex-1 min-w-0'>
                                      <div className='flex items-center gap-2'>
                                        <span className='font-medium text-sm text-gray-800 dark:text-gray-200'>
                                          {skill.name}
                                        </span>
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                                            skill.type === 'official'
                                              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                          }`}
                                        >
                                          {skill.type === 'official' ? '官方' : '个人'}
                                        </span>
                                      </div>
                                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2'>
                                        {skill.description}
                                      </p>
                                    </div>
                                    {selectedSkill?.id === skill.id && (
                                      <CheckCircleFilled className='text-purple-500 flex-shrink-0 text-sm' />
                                    )}
                                  </div>
                                ))}

                              {/* Empty State */}
                              {(skillsList || []).filter(
                                skill =>
                                  !skillSearchQuery ||
                                  skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                                  skill.description.toLowerCase().includes(skillSearchQuery.toLowerCase()),
                              ).length === 0 && (
                                <div className='text-center py-8 text-gray-400'>
                                  <ThunderboltOutlined className='text-2xl mb-2 opacity-50' />
                                  <div className='text-xs'>
                                    {skillSearchQuery ? '未找到匹配的技能' : '暂无可用技能'}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Footer */}
                            <div className='border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50'>
                              <span className='text-[10px] text-gray-400'>{(skillsList || []).length} 个技能可用</span>
                              <Button
                                type='link'
                                size='small'
                                onClick={() => {
                                  router.push('/construct/skills');
                                  setIsSkillPanelOpen(false);
                                }}
                                className='text-[10px] p-0 h-auto'
                              >
                                管理技能 →
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Tooltip title={selectedSkill ? `技能: ${selectedSkill.name}` : '选择技能'}>
                          <Button
                            type='text'
                            shape='circle'
                            className={`relative text-gray-500 hover:bg-gray-100 ${selectedSkill ? 'bg-purple-50 text-purple-500' : ''}`}
                          >
                            <div className='relative'>
                              <ThunderboltOutlined className={selectedSkill ? 'text-purple-500' : ''} />
                              {selectedSkill && (
                                <span className='absolute -top-1 -right-1 bg-purple-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold'>
                                  1
                                </span>
                              )}
                            </div>
                          </Button>
                        </Tooltip>
                      </Popover>

                      {/* Database Selector Popover */}
                      <Popover
                        trigger='click'
                        placement='topLeft'
                        open={isDbPanelOpen}
                        onOpenChange={setIsDbPanelOpen}
                        overlayClassName='manus-database-menu'
                        overlayInnerStyle={{ padding: 0, borderRadius: 12 }}
                        content={
                          <div className='w-[320px] bg-white dark:bg-[#2c2d31] rounded-xl shadow-xl overflow-hidden'>
                            <div className='p-3 border-b border-gray-100 dark:border-gray-700'>
                              <Input
                                placeholder='搜索数据库'
                                prefix={<SearchOutlined className='text-gray-400' />}
                                value={dbSearchQuery}
                                onChange={e => setDbSearchQuery(e.target.value)}
                                className='rounded-lg'
                                allowClear
                                size='small'
                              />
                            </div>

                            <div className='max-h-[300px] overflow-y-auto'>
                              {(dataSources || [])
                                .filter(
                                  ds =>
                                    !dbSearchQuery ||
                                    ds.db_name.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
                                    ds.type.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
                                    (ds.description &&
                                      ds.description.toLowerCase().includes(dbSearchQuery.toLowerCase())),
                                )
                                .map(ds => (
                                  <div
                                    key={ds.id}
                                    onClick={() => {
                                      setSelectedDb(ds);
                                      setIsDbPanelOpen(false);
                                      setDbSearchQuery('');
                                    }}
                                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                      selectedDb?.id === ds.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                    }`}
                                  >
                                    <div className='flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs'>
                                      {getDbIcon(ds.type)}
                                    </div>
                                    <div className='flex-1 min-w-0'>
                                      <div className='flex items-center gap-2'>
                                        <span className='font-medium text-sm text-gray-800 dark:text-gray-200'>
                                          {ds.db_name}
                                        </span>
                                        <span className='text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5'>
                                          {ds.type}
                                        </span>
                                      </div>
                                      {ds.description && (
                                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2'>
                                          {ds.description}
                                        </p>
                                      )}
                                    </div>
                                    {selectedDb?.id === ds.id && (
                                      <CheckCircleFilled className='text-blue-500 flex-shrink-0 text-sm' />
                                    )}
                                  </div>
                                ))}

                              {(dataSources || []).filter(
                                ds =>
                                  !dbSearchQuery ||
                                  ds.db_name.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
                                  ds.type.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
                                  (ds.description && ds.description.toLowerCase().includes(dbSearchQuery.toLowerCase())),
                              ).length === 0 && (
                                <div className='text-center py-8 text-gray-400'>
                                  <DatabaseOutlined className='text-2xl mb-2 opacity-50' />
                                  <div className='text-xs'>
                                    {dbSearchQuery ? '未找到匹配的数据库' : '暂无可用数据库'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className='border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50'>
                              <span className='text-[10px] text-gray-400'>
                                {(dataSources || []).length} 个数据库可用
                              </span>
                              <Button
                                type='link'
                                size='small'
                                onClick={() => {
                                  router.push('/construct/database');
                                  setIsDbPanelOpen(false);
                                }}
                                className='text-[10px] p-0 h-auto'
                              >
                                管理数据库 →
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Tooltip title={selectedDb ? `数据库: ${selectedDb.db_name}` : '选择数据库'}>
                          <Button
                            type='text'
                            shape='circle'
                            className={`relative text-gray-500 hover:bg-gray-100 ${selectedDb ? 'bg-blue-50 text-blue-500' : ''}`}
                          >
                            <div className='relative'>
                              <DatabaseOutlined className={selectedDb ? 'text-blue-500' : ''} />
                              {selectedDb && (
                                <span className='absolute -top-1 -right-1 bg-blue-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold'>
                                  1
                                </span>
                              )}
                            </div>
                          </Button>
                        </Tooltip>
                      </Popover>

                      <Popover
                        trigger='click'
                        placement='topLeft'
                        open={isKnowledgePanelOpen}
                        onOpenChange={setIsKnowledgePanelOpen}
                        overlayClassName='manus-knowledge-menu'
                        overlayInnerStyle={{ padding: 0, borderRadius: 12 }}
                        content={
                          <div className='w-[320px] bg-white dark:bg-[#2c2d31] rounded-xl shadow-xl overflow-hidden'>
                            <div className='p-3 border-b border-gray-100 dark:border-gray-700'>
                              <Input
                                placeholder='搜索知识库'
                                prefix={<SearchOutlined className='text-gray-400' />}
                                value={knowledgeSearchQuery}
                                onChange={e => setKnowledgeSearchQuery(e.target.value)}
                                className='rounded-lg'
                                allowClear
                                size='small'
                              />
                            </div>

                            <div className='max-h-[300px] overflow-y-auto'>
                              {(knowledgeSpaces || [])
                                .filter(
                                  space =>
                                    !knowledgeSearchQuery ||
                                    space.name.toLowerCase().includes(knowledgeSearchQuery.toLowerCase()) ||
                                    (space.desc &&
                                      space.desc.toLowerCase().includes(knowledgeSearchQuery.toLowerCase())),
                                )
                                .map(space => (
                                  <div
                                    key={space.id}
                                    onClick={() => {
                                      setSelectedKnowledge(space);
                                      setIsKnowledgePanelOpen(false);
                                      setKnowledgeSearchQuery('');
                                    }}
                                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                      selectedKnowledge?.id === space.id ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                                    }`}
                                  >
                                    <div className='flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white text-xs'>
                                      <BookOutlined />
                                    </div>
                                    <div className='flex-1 min-w-0'>
                                      <div className='flex items-center gap-2'>
                                        <span className='font-medium text-sm text-gray-800 dark:text-gray-200'>
                                          {space.name}
                                        </span>
                                      </div>
                                      {space.desc && (
                                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2'>
                                          {space.desc}
                                        </p>
                                      )}
                                    </div>
                                    {selectedKnowledge?.id === space.id && (
                                      <CheckCircleFilled className='text-orange-500 flex-shrink-0 text-sm' />
                                    )}
                                  </div>
                                ))}

                              {(knowledgeSpaces || []).filter(
                                space =>
                                  !knowledgeSearchQuery ||
                                  space.name.toLowerCase().includes(knowledgeSearchQuery.toLowerCase()) ||
                                  (space.desc && space.desc.toLowerCase().includes(knowledgeSearchQuery.toLowerCase())),
                              ).length === 0 && (
                                <div className='text-center py-8 text-gray-400'>
                                  <BookOutlined className='text-2xl mb-2 opacity-50' />
                                  <div className='text-xs'>
                                    {knowledgeSearchQuery ? '未找到匹配的知识库' : '暂无可用知识库'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className='border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50'>
                              <span className='text-[10px] text-gray-400'>
                                {(knowledgeSpaces || []).length} 个知识库可用
                              </span>
                              <Button
                                type='link'
                                size='small'
                                onClick={() => {
                                  router.push('/knowledge');
                                  setIsKnowledgePanelOpen(false);
                                }}
                                className='text-[10px] p-0 h-auto'
                              >
                                管理知识库 →
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Tooltip title={selectedKnowledge ? `知识库: ${selectedKnowledge.name}` : '选择知识库'}>
                          <Button
                            type='text'
                            shape='circle'
                            className={`relative text-gray-500 hover:bg-gray-100 ${selectedKnowledge ? 'bg-orange-50 text-orange-500' : ''}`}
                          >
                            <div className='relative'>
                              <BookOutlined className={selectedKnowledge ? 'text-orange-500' : ''} />
                              {selectedKnowledge && (
                                <span className='absolute -top-1 -right-1 bg-orange-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold'>
                                  1
                                </span>
                              )}
                            </div>
                          </Button>
                        </Tooltip>
                      </Popover>

                      {/* Model Selector */}
                      <ModelSelector onChange={val => setModel(val)} />
                    </div>

                    <div className='flex items-center gap-2'>
                      <Tooltip title='Voice Input'>
                        <Button type='text' shape='circle' icon={<AudioOutlined />} className='text-gray-500' />
                      </Tooltip>
                      <Button
                        type='primary'
                        shape='circle'
                        size='large'
                        icon={<ArrowUpOutlined />}
                        onClick={() => handleStart()}
                        disabled={!query.trim() && !uploadedFile}
                        className={`${query.trim() || uploadedFile ? 'bg-black hover:bg-gray-800' : 'bg-gray-200 text-gray-400 hover:bg-gray-200'} border-none shadow-none`}
                      />
                    </div>
                  </div>

                  {/* Database & Knowledge Base Selectors - Manus Style */}
                  <div className='mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3'>
                    {/* Database Selector */}
                    <Button
                      type='text'
                      size='small'
                      onClick={() => setIsDbModalOpen(true)}
                      className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 h-auto ${
                        selectedDb
                          ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <DatabaseOutlined />
                      <span>{selectedDb ? selectedDb.db_name : '数据库'}</span>
                    </Button>

                    {/* Knowledge Base Selector */}
                    <Button
                      type='text'
                      size='small'
                      onClick={() => setIsKnowledgeModalOpen(true)}
                      className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 h-auto ${
                        selectedKnowledge
                          ? 'bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400'
                          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <BookOutlined />
                      <span>{selectedKnowledge ? selectedKnowledge.name : '知识库'}</span>
                    </Button>

                    {/* Selected Skill Badge (if any) */}
                    {selectedSkill && (
                      <Tag
                        closable
                        onClose={() => setSelectedSkill(null)}
                        className='flex items-center gap-1 text-xs rounded-lg px-2 py-1 m-0 bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700'
                      >
                        <ThunderboltOutlined />
                        <span>{selectedSkill.name}</span>
                      </Tag>
                    )}
                  </div>
                </div>

                {/* Recommended Examples */}
                <div className='mt-10 w-full'>
                  <div className='flex items-center justify-center gap-2 mb-4'>
                    <div className='h-px flex-1 bg-gradient-to-r from-transparent to-gray-200 dark:to-gray-700' />
                    <span className='text-xs font-medium text-gray-400 dark:text-gray-500 tracking-wider uppercase'>
                      推荐示例
                    </span>
                    <div className='h-px flex-1 bg-gradient-to-l from-transparent to-gray-200 dark:to-gray-700' />
                  </div>
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                    {EXAMPLE_CARDS.map(example => (
                      <div
                        key={example.id}
                        onClick={() => handleExampleClick(example)}
                        className={`group relative bg-gradient-to-br ${example.color} border ${example.borderColor} rounded-2xl p-4 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300`}
                      >
                        <div className='flex items-start gap-3'>
                          <div
                            className={`w-10 h-10 ${example.iconBg} rounded-xl flex items-center justify-center text-xl flex-shrink-0`}
                          >
                            {example.icon}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <h3 className='text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1'>
                              {example.title}
                            </h3>
                            <p className='text-xs text-gray-500 dark:text-gray-400 line-clamp-2'>
                              {example.description}
                            </p>
                          </div>
                        </div>
                        <div className='absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity'>
                          <RightOutlined className='text-xs text-gray-400' />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Promo - Only show when no messages */}
          {messages.length === 0 && (
            <div className='absolute bottom-6 left-0 right-0 flex justify-center'>
              <div className='bg-gray-50 dark:bg-[#2c2d31] px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center gap-4 shadow-sm cursor-pointer hover:bg-gray-100'>
                <div className='w-8 h-8 bg-black rounded-lg text-white flex items-center justify-center font-serif italic'>
                  D
                </div>
                <div className='flex flex-col'>
                  <span className='text-xs font-bold text-gray-800 dark:text-gray-200'>Data-Driven Decisions</span>
                  <span className='text-[10px] text-gray-500'>Empower your business with AI analytics</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Database Selection Modal */}
        <Modal
          title={
            <div className='flex items-center gap-2'>
              <DatabaseOutlined />
              Select Data Source
            </div>
          }
          open={isDbModalOpen}
          onCancel={() => setIsDbModalOpen(false)}
          footer={null}
          width={500}
        >
          <List
            itemLayout='horizontal'
            dataSource={dataSources || []}
            renderItem={(item: DataSource) => (
              <List.Item
                className={`cursor-pointer hover:bg-gray-50 rounded-lg px-2 transition-colors ${selectedDb?.id === item.id ? 'bg-blue-50' : ''}`}
                onClick={() => {
                  setSelectedDb(item);
                  setIsDbModalOpen(false);
                }}
                actions={[selectedDb?.id === item.id && <CheckCircleFilled className='text-blue-500' />]}
              >
                <List.Item.Meta
                  avatar={<div className='mt-1 bg-gray-100 p-2 rounded-lg'>{getDbIcon(item.type)}</div>}
                  title={item.db_name}
                  description={<span className='text-xs text-gray-400'>{item.type}</span>}
                />
              </List.Item>
            )}
            locale={{ emptyText: 'No data sources found' }}
          />
          <div className='mt-4 pt-4 border-t border-gray-100 text-center'>
            <Button type='dashed' block icon={<PlusOutlined />} onClick={() => router.push('/construct/database')}>
              Add New Data Source
            </Button>
          </div>
        </Modal>

        {/* Knowledge Base Selection Modal */}
        <Modal
          title={
            <div className='flex items-center gap-2'>
              <BookOutlined />
              Select Knowledge Base
            </div>
          }
          open={isKnowledgeModalOpen}
          onCancel={() => setIsKnowledgeModalOpen(false)}
          footer={null}
          width={500}
        >
          <List
            itemLayout='horizontal'
            dataSource={knowledgeSpaces || []}
            renderItem={(item: KnowledgeSpace) => (
              <List.Item
                className={`cursor-pointer hover:bg-gray-50 rounded-lg px-2 transition-colors ${selectedKnowledge?.id === item.id ? 'bg-orange-50' : ''}`}
                onClick={() => {
                  setSelectedKnowledge(item);
                  setIsKnowledgeModalOpen(false);
                }}
                actions={[selectedKnowledge?.id === item.id && <CheckCircleFilled className='text-orange-500' />]}
              >
                <List.Item.Meta
                  avatar={
                    <div className='mt-1 bg-gray-100 p-2 rounded-lg'>
                      <ReadOutlined className='text-orange-500' />
                    </div>
                  }
                  title={item.name}
                  description={<span className='text-xs text-gray-400'>{item.vector_type}</span>}
                />
              </List.Item>
            )}
            locale={{ emptyText: 'No knowledge bases found' }}
          />
          <div className='mt-4 pt-4 border-t border-gray-100 text-center'>
            <Button type='dashed' block icon={<PlusOutlined />} onClick={() => router.push('/construct/knowledge')}>
              Add New Knowledge Base
            </Button>
          </div>
        </Modal>
      </div>
    </ConfigProvider>
  );
};

export default Playground;
