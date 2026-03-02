import { ChatEn } from '../en/chat';

type I18nKeys = keyof typeof ChatEn;

export interface Resources {
  translation: Record<I18nKeys, string>;
}

export const ChatZh: Resources['translation'] = {
  dialog_list: '对话列表',
  delete_chat: '删除会话',
  delete_chat_confirm: '您确认要删除会话吗？',
  input_tips: '可以问我任何问题，shift + Enter 换行',
  sent: '发送',
  answer_again: '重新回答',
  feedback_tip: '描述一下具体问题或更优的答案',
  thinking: '正在思考中',
  stop_replying: '停止回复',
  erase_memory: '清除记忆',
  copy_success: '复制成功',
  copy_failed: '复制失败',
  copy_nothing: '内容复制为空',
  file_tip: '文件上传后无法更改',
  file_upload_tip: '上传文件到对话（您的模型必须支持多模态输入）',
  chat_online: '在线对话',
  assistant: '平台小助手', // 灵数平台小助手
  model_tip: '当前应用暂不支持模型选择',
  temperature_tip: '当前应用暂不支持温度配置',
  max_new_tokens_tip: '当前应用暂不支持max_new_tokens配置',
  extend_tip: '当前应用暂不支持拓展配置',
  cot_title: '思考',
  code_preview: '预览',
  code_preview_full_screen: '全屏',
  code_preview_exit_full_screen: '退出全屏',
  code_preview_code: '代码',
  code_preview_copy: '复制',
  code_preview_already_copied: '已复制',
  code_preview_download: '下载',
  code_preview_run: '运行',
  code_preview_close: '关闭',
  ask_data_question: '向您的数据库提问，上传CSV，或生成报告...',
  recommend_examples: '推荐示例',
  example_walmart_sales_title: '沃尔玛销售数据分析',
  example_walmart_sales_desc: '分析沃尔玛销售CSV数据，生成可视化网页报告',
  example_walmart_sales_query:
    '请全面分析这份沃尔玛销售数据，包括各门店销售趋势、假日影响、温度与油价对销售的影响等维度，生成一份精美的交互式网页分析报告。',
  example_db_profile_report_title: '数据库画像与分析报告',
  example_db_profile_report_desc: '连接数据库后，生成数据库画像并生成可视化网页报告',
  example_db_profile_report_query:
    '请分析当前连接的数据库，生成数据库画像（包括表结构、字段信息、数据量统计等），并生成一份精美的交互式网页分析报告。',
  example_fin_report_title: '金融财报深度分析',
  example_fin_report_desc: '分析浙江海翔药业年度报告，生成数据可视化报告',
  example_fin_report_query:
    '请深度分析这份浙江海翔药业2019年年度报告，包括营收利润趋势、资产负债结构、现金流分析、关键财务指标等，生成一份专业的交互式网页分析报告。',
  example_create_sql_skill_title: '创建SQL分析技能',
  example_create_sql_skill_desc: '使用skill-creator创建一个实用的SQL数据分析技能',
  example_create_sql_skill_query:
    '请使用 skill-creator 帮我创建一个实用的SQL数据分析技能，包含连接数据库、执行SQL查询和数据可视化等核心功能。',
  add_from_local: '从本地文件添加',
  use_skill: '使用技能',
  use_knowledge: '使用知识库',
  use_database: '使用数据库',
  execution_steps: '执行步骤',
  db_gpt_computer: 'DB-GPT 的电脑',
  load_skill: '加载技能',
} as const;
