# StyleSlice MVP

StyleSlice 是一个面向游戏 UI 资产生产的节点式画布工具。它的目标不是只生成一张好看的 UI 参考图，而是把“参考图风格分析 → 风格包 → 原子组件/完整界面生成 → 组件拆解 → 切片质检 → Unity 导出”串成一个可迭代的生产流程。

当前项目适合个人本地使用，也保留了后续轻量部署和多人使用的接口空间。

## 核心功能

- 节点式工作台：基于 React Flow，可拖拽节点、自由连线、框选、快捷复制、删除和整理。
- 参考图组：支持上传多张 PNG/JPG/WebP，节点内可切换主图。
- 多模态风格分析：调用视觉模型分析参考图，生成色板、材质、形状、装饰语言和结构化提示词。
- AI 生图：支持 ModelScope、SiliconFlow、DashScope 后端代理链路。
- 原子组件板：按组件类型和数量生成按钮、面板、徽章、进度条、对话框、头像框等 UI 资产。
- 完整界面生成：根据风格包和文本需求生成完整游戏 UI 界面参考图。
- 资产拆解：色板、组件候选、底图、IP、Icon、字体等节点可从任意上游图像资产继续分析。
- 切片与质检：从组件板或拆解资产中生成 PNG 切片，并给出基础九宫格建议。
- Unity 导出：打包 PNG、`sprites.json` 与导入说明。
- 项目管理与自动保存：支持项目新建、复制、删除、命名和本地自动保存。

## 技术栈

- 前端：React 19、TypeScript、Vite
- 画布：@xyflow/react
- 图标：lucide-react
- 导出：JSZip
- 本地代理：Node.js HTTP Server
- AI 平台：ModelScope API-Inference、SiliconFlow、DashScope

## 环境要求

建议环境：

- Node.js 20+
- npm 10+
- Windows / macOS / Linux 均可运行

检查版本：

```bash
node -v
npm -v
```

## 安装依赖

```bash
npm install
```

## API Key 获取方式

项目支持多个平台。你可以只配置其中一个，也可以同时配置多个，在软件内切换。

### 1. SiliconFlow 硅基流动

1. 打开 [SiliconFlow 控制台](https://cloud.siliconflow.cn/)
2. 登录后进入 API Key 管理页面
3. 新建 API Key
4. 推荐模型示例：
   - 文字/视觉模型：`Qwen/Qwen3.5-35B-A3B` 或平台当前可用的多模态模型
   - 生图模型：`Tongyi-MAI/Z-Image`、`Tongyi-MAI/Z-Image-Turbo` 或平台当前支持的图像生成模型

SiliconFlow 官方文档：[https://api-docs.siliconflow.cn/docs/userguide/get_started/introduction](https://api-docs.siliconflow.cn/docs/userguide/get_started/introduction)

### 2. ModelScope 魔搭

1. 打开 [ModelScope](https://www.modelscope.cn/)
2. 登录账号
3. 进入个人中心 / 令牌管理，创建 API Token
4. 在软件内选择 ModelScope，并填写：
   - Base URL：`https://api-inference.modelscope.cn/v1`
   - 文字/视觉路径：`/chat/completions`
   - 生图路径：`/images/generations`

ModelScope 文档：[https://www.modelscope.cn/docs/home](https://www.modelscope.cn/docs/home)

注意：ModelScope 生图模型可能存在异步调用、额度、模型 ID 和轮询路径差异。如果遇到额度或异步错误，可切换到 SiliconFlow 或 DashScope 后端代理。

### 3. DashScope 通义千问/通义万相

DashScope 主要通过本地代理调用，可作为 ModelScope 生图不稳定时的备选。

1. 打开阿里云 DashScope 控制台
2. 创建 API Key
3. 将 `DASHSCOPE_API_KEY` 写入 `.env`

## 环境变量配置

复制示例文件：

```bash
copy .env.example .env
```

macOS/Linux：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
MODELSCOPE_API_KEY=your_modelscope_api_inference_token_here
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
DASHSCOPE_API_KEY=your_dashscope_api_key_here
STYLESLICE_API_PORT=8787
```

说明：

- 如果只在前端设置面板中填写 API Key，也可以运行。
- 更推荐把 Key 写入 `.env`，并始终通过本地代理调用，避免 Key 暴露在浏览器请求里。
- `.env` 不应该提交到 GitHub。

## 运行步骤

需要同时启动前端和本地 API 代理，建议开两个终端。

终端 1：启动前端

```bash
npm run dev
```

默认访问：

```text
http://localhost:5173/
```

如果 Vite 自动分配了其他端口，以终端输出为准。

终端 2：启动本地 API 代理

```bash
npm run api
```

默认代理地址：

```text
http://127.0.0.1:8787
```

软件内 AI 设置推荐：

- 调用平台：`SiliconFlow 硅基流动`
- Base URL：`https://api.siliconflow.cn/v1`
- 生图协议：`SiliconFlow 后端代理`
- 本地代理：`http://127.0.0.1:8787`
- 文字/视觉路径：`/chat/completions`
- 生图路径：`/images/generations`

配置后点击“分项测试”，确认：

- 本地代理通过
- 文字模型通过
- 视觉模型通过
- 生图模型通过

## 典型使用流程

1. 上传 3-5 张参考图到“参考图组”节点。
2. 运行“设计风格包”，生成色板、材质、形状语言和提示词。
3. 根据需要连接：
   - “原子组件板”：生成可复用 UI 组件。
   - “界面生成”：生成完整游戏 UI 界面。
   - “组件候选 / Icon / 底图 / IP / 字体”：对现有图像做拆解分析。
4. 运行“切片与质检”，得到 PNG 切片和九宫格建议。
5. 运行“Unity 导出”，下载 ZIP。

## 常见问题

### 1. 生图失败：Invalid API Key

检查：

- API Key 是否复制完整
- 当前平台是否选择正确
- 本地代理是否正在运行
- `.env` 中是否写错 Key

### 2. ModelScope 提示异步调用错误

ModelScope 部分生图模型要求异步调用。当前项目已为后端代理保留异步轮询逻辑，但不同模型的任务路径可能不一致。建议优先使用 SiliconFlow 或 DashScope 进行稳定生图。

### 3. 生成图像风格不一致

建议：

- 上传 3-5 张风格一致的参考图
- 避免参考图里角色/IP 占比过大，否则模型容易生成贴纸或角色头像
- 先运行“设计风格包”，检查提示词是否已经正确提取 UI 材质、边框、阴影和色板
- 原子组件板尽量少量、多轮生成，再进行切片

### 4. 切片不理想

当前切片仍是 MVP 级算法，适合干净组件板。复杂背景、重叠元素、角色贴纸会降低切片质量。后续计划接入更强的目标检测/分割能力。

## 构建

```bash
npm run build
```

本地预览构建结果：

```bash
npm run preview
```

## 目录结构

```text
styleslice-mvp/
├─ server/                  # 本地 API 代理
├─ src/
│  ├─ components/           # 工作台、节点、设置面板
│  ├─ data/                 # 节点注册表、组件类型目录
│  ├─ lib/                  # AI 调用、工作流执行、图像处理
│  └─ types/                # 工作流与配置类型
├─ docs/                    # 阶段总结、设计文档、复盘
├─ .env.example             # 环境变量模板
└─ README.md
```

## 开发状态

当前版本是面向课程项目和个人生产流的 MVP。它已经具备完整工作流，但图像生成质量、自动切片精度、复杂界面拆解和模型平台稳定性仍是下一阶段重点。
