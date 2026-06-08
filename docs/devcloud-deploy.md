# DevCloud 部署说明

本项目采用一个 Node 服务同时托管前端页面和后端 API。

- 前端入口：`/`
- 健康检查：`/api/health`
- AI 修图接口：`/api/gpt-image2/fix-image`
- OCR/视觉接口：`/api/vision/identify-text`

## 1. 前置条件

- 已有 DevCloud CVM 或工蜂 IDE DevCloud 主机工作空间
- 机器已安装 Node.js 20+
- 机器可以访问工蜂仓库 `git@git.woa.com:casonchen/sucai_tool.git`
- 机器可以访问内部模型网关：
  - `http://v2.open.venus.oa.com/llmproxy`
  - `http://v2.open.venus.oa.com/chatproxy`

## 2. 拉取代码

```bash
git clone git@git.woa.com:casonchen/sucai_tool.git
cd sucai_tool
```

## 3. 配置密钥

真实 token 只放在 DevCloud 机器的 `server/.env`，不要提交到 Git。

```bash
cp server/.env.example server/.env
vi server/.env
```

至少需要配置：

```env
GPT_IMAGE2_API_KEY=你的真实token
HOST=0.0.0.0
PORT=3000
ALLOWED_ORIGINS=
```

如果后续前后端分域部署，再把 `ALLOWED_ORIGINS` 改为正式前端域名；当前同源部署可留空。

## 4. 启动服务

### 前台启动

```bash
npm start
```

### 后台启动

```bash
bash scripts/devcloud-start.sh
```

查看日志：

```bash
tail -f logs/server.log
```

停止服务：

```bash
bash scripts/devcloud-stop.sh
```

## 5. 验证

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

返回类似：

```json
{"ok":true,"service":"sucai-tool-gpt-image2-server"}
```

## 6. 访问地址

### DevCloud CVM

如果 DevCloud 机器有内部域名或 IP，可访问：

```text
http://机器域名或IP:3000
```

如需对团队开放，建议在 DevCloud/网络侧只开放必要端口，并按公司规范申请域名或网关接入。

### 工蜂 IDE 工作空间

服务必须监听 `0.0.0.0:3000`。启动后可通过工蜂 IDE 的端口入口打开，或按规则拼接：

```text
https://${workspaceId}-3000.gateway.cloudide.woa.com/
```

## 7. 更新代码

```bash
git pull --ff-only
bash scripts/devcloud-stop.sh
bash scripts/devcloud-start.sh
```

## 8. 安全注意

- 不要把 `server/.env`、真实 token、截图中的密钥提交到 Git。
- 服务对外开放前，确认 `ALLOWED_ORIGINS`、访问权限和网络策略。
- 如接入网关或域名，优先使用 HTTPS。
