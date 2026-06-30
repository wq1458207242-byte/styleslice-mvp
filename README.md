# StyleSlice

> 一个面向游戏 UI 资产生产的 AI 节点式画布工具：从参考图风格分析，到组件生成、资产拆解、切片质检和 Unity 导出。

StyleSlice 的目标不是只生成一张“看起来不错”的 UI 参考图，而是把游戏 UI 生产中更麻烦的一段流程串起来：

```text
参考图 / 文本需求
    → 多模态风格分析
    → 设计风格包
    → 原子组件板 / 完整界面生成
    → 组件候选、Icon、底图、IP、字体等资产拆解
    → 切片与质检
    → Unity PNG 资产导出
```

它适合独立游戏开发、课程原型、小型团队 UI 资产探索，以及需要从少量参考图快速产出游戏 UI 切片资源的场景。

## 功能特性

- 节点式工作台：基于 React Flow，支持拖拽节点、自由连线、框选、复制、删除、整理和运行。
- 参考图组：支持上传多张 PNG/JPG/WebP，并在节点内切换主图。
- 多模态风格分析：调用视觉理解模型提取色板、材质、形状、边框、装饰语言和结构化提示词。
- 多平台 AI 接入：支持 ModelScope、SiliconFlow、DashScope 等平台配置。
- 本地 API 代理：通过 Node.js 本地服务转发请求，降低 CORS、临时图片 URL 和 API Key 暴露问题。
- 原子组件板：按组件分类与数量生成按钮、面板、徽章、进度条、对话框、头像框等可复用 UI 元素。
- 完整界面生成：根据风格包和文本需求生成完整游戏 UI 界面参考图。
- 通用资产拆解：色板、组件候选、底图、IP、Icon、字体等节点可从任意上游图像结果继续分析。
- 切片与质检：将组件板或拆解资产转为 PNG 候选切片，并给出基础九宫格建议。
- Unity 导出：打包 PNG、`sprites.json` 和导入说明。
- 项目管理：支持新建、复制、删除、重命名、自动保存和本地项目切换。

## 技术栈

- Frontend：React 19、TypeScript、Vite
- Canvas Workflow：@xyflow/react
- UI Icons：lucide-react
- Export：JSZip
- Backend Proxy：Node.js HTTP Server
- AI Providers：ModelScope API-Inference、SiliconFlow、DashScope

## 项目结构

```text
styleslice-mvp/
├─ server/                  # 本地 API 代理服务
│  └─ index.mjs
├─ src/
│  ├─ components/           # 工作台、节点、Inspector、AI 设置面板
│  ├─ data/                 # 节点注册表、组件类型目录
│  ├─ lib/                  # AI 调用、工作流执行、图像处理
│  ├─ types/                # 工作流、项目、AI 配置类型
│  ├─ App.tsx
│  └─ main.tsx
├─ docs/                    # 设计文档、阶段总结、复盘
├─ .env.example             # 环境变量示例
├─ package.json
└─ README.md
```

## 环境要求

建议使用：

- Node.js 20+
- npm 10+

检查本地环境：

```bash
node -v
npm -v
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

`.env` 示例：

```env
MODELSCOPE_API_KEY=your_modelscope_api_inference_token_here
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
DASHSCOPE_API_KEY=your_dashscope_api_key_here
STYLESLICE_API_PORT=8787
```

说明：

- 如果只是本地个人使用，也可以直接在软件的「AI 推理设置」里填写 API Key。
- 如果准备部署或共享给他人使用，建议只在后端环境变量中保存 Key，不要把 Key 暴露在前端。
- `.env` 不应提交到 GitHub。

### 3. 启动本地 API 代理

打开第一个终端：

```bash
npm run api
```

默认代理地址：

```text
http://127.0.0.1:8787
```

### 4. 启动前端

打开第二个终端：

```bash
npm run dev
```

默认访问：

```text
http://localhost:5173
```

如果 Vite 输出了其他端口，以终端提示为准。

## AI 平台配置

打开应用右上角「AI 设置」，可以选择不同平台。

### SiliconFlow 硅基流动

推荐作为当前主要生图平台之一。

- Base URL：`https://api.siliconflow.cn/v1`
- 文字/视觉路径：`/chat/completions`
- 生图路径：`/images/generations`
- 生图协议：`SiliconFlow 后端代理`
- 本地代理：`http://127.0.0.1:8787`

API Key 获取：

1. 打开 [SiliconFlow 控制台](https://cloud.siliconflow.cn/)
2. 登录账号
3. 进入 API Key 管理页面
4. 创建并复制 API Key

模型填写请以平台当前可用模型为准，例如：

- 文字/视觉模型：`Qwen/Qwen3.5-35B-A3B`
- 生图模型：`Tongyi-MAI/Z-Image` 或 `Tongyi-MAI/Z-Image-Turbo`

官方文档：[SiliconFlow Docs](https://api-docs.siliconflow.cn/docs/userguide/get_started/introduction)

### ModelScope 魔搭

- Base URL：`https://api-inference.modelscope.cn/v1`
- 文字/视觉路径：`/chat/completions`
- 生图路径：`/images/generations`

API Key 获取：

1. 打开 [ModelScope](https://www.modelscope.cn/)
2. 登录账号
3. 进入个人中心或令牌管理
4. 创建 API Token

官方文档：[ModelScope Docs](https://www.modelscope.cn/docs/home)

注意：ModelScope 的部分生图模型可能涉及异步调用、额度限制、模型 ID 差异和任务轮询路径差异。如果遇到 `task not found`、额度超限或同步调用不支持，可以切换到 SiliconFlow 或 DashScope。

### DashScope

DashScope 当前主要作为后端代理中的补充生图方案。使用时请在 `.env` 中配置：

```env
DASHSCOPE_API_KEY=your_dashscope_api_key_here
```

## 推荐使用流程

1. 上传 3-5 张风格一致的参考图到「参考图组」节点。
2. 运行「设计风格包」节点，生成色板、材质、形状语言和提示词。
3. 根据目标选择后续节点：
   - 「原子组件板」：生成按钮、面板、徽章、进度条等可复用组件。
   - 「界面生成」：生成完整游戏 UI 界面参考图。
   - 「组件候选 / Icon / 底图 / IP / 字体」：从已有图像中继续拆解局部资产。
4. 运行「切片与质检」，得到 PNG 候选切片和基础九宫格建议。
5. 运行「Unity 导出」，下载 ZIP。

## 常用脚本

```bash
# 启动前端开发服务
npm run dev

# 启动本地 API 代理
npm run api

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

## 常见问题

### 生图失败：Invalid API Key

请检查：

- API Key 是否完整复制
- 当前选择的平台是否与 Key 对应
- 本地代理是否已运行
- `.env` 是否配置正确
- 软件内 AI 设置是否覆盖了旧配置

### ModelScope 生图任务找不到结果

可能原因包括：

- 模型要求异步调用
- 模型 ID 不正确
- 当前账号额度不足
- 轮询路径与模型返回结构不一致

建议优先点击「分项测试」确认文字、视觉、生图三项能力是否分别可用。

### 生成结果不像参考图

建议：

- 参考图数量控制在 3-5 张
- 保持参考图风格一致
- 避免参考图中角色/IP 占比过大
- 先检查「设计风格包」中的参考图证据和结构化提示词是否准确
- 组件生成尽量少量多轮，而不是一次生成过多元素

### 切片效果不理想

当前切片逻辑适合干净、分离度较高的组件板。复杂背景、组件重叠、文字贴图和角色贴纸会降低自动切片质量。后续计划接入更强的目标检测、分割和可编辑 bbox。

## 开发状态

当前版本是课程项目与个人生产流导向的 MVP，已经具备完整的工作链路，但仍有以下优化方向：

- 更稳定的图像生成模型选择与模型效果评测
- 更精确的组件检测、分割和透明化
- 可编辑切片框与手动修正流程
- 提示词版本管理与生成结果对比
- Unity 九宫格导入配置增强
- 后端化部署，彻底避免前端暴露 API Key

## 文档

- [设计文档](docs/DESIGN_DOCUMENT.md)
- [阶段总结](docs/STAGE_SUMMARY_2026-06-25.md)
- [问题复盘](docs/ERROR_RETROSPECTIVE_2026-06-25.md)
- [下一步计划](docs/NEXT_PLAN_2026-06-25.md)

## License

当前项目主要用于课程作业与个人研究。若计划公开发布或商业使用，请补充明确的开源协议，并确认所调用模型、参考图和生成资产的授权边界。
