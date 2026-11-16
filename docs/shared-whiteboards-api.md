# 共享白板接入文档（开发者与 Agent）

本文是调用方实现“查询白板、创建白板、加入白板”的接入契约。可以将本文件直接交给开发 Agent；无需依赖聊天记录。接口以本仓库当前实现为准，没有独立的 API 版本号。

## 1. 先选择接入方式

| 需求                                     | 推荐流程                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| 在自己的产品中列出白板，再打开 Mico 页面 | 查询列表 → 选择 ID → 构造加入链接 → 导航或由用户点击打开                  |
| 创建白板后，让用户进入 Mico 页面         | 创建白板 → 保存返回的 ID → 构造加入链接 → 打开页面                        |
| 自己实现白板客户端，而不是使用 Mico 页面 | 查询或创建 → 调用加入接口 → 立即连接 WebSocket → 处理快照、在线成员和重连 |

**打开 Mico 页面时，不要提前调用加入接口。** 页面会生成自己的 `clientId` 并完成加入。提前以另一个 `clientId` 请求演示者，会占用演示者名额，使页面随后收到 `PRESENTER_EXISTS`。

共享集合与私人画布集合独立。不要使用 `/api/canvases` 代替共享白板列表接口，不要将私人画布 ID 当作共享白板 ID。

## 2. 地址、身份与请求约定

- `BASE_URL`：Mico 浏览器页面的源地址，例如开发环境 `http://127.0.0.1:7063`，或部署后的 `https://mico.example.com`。由接入方配置，不要硬编码演示实例的临时端口。
- HTTP 和 WebSocket 应使用同一个对外源地址。开发环境经过 Vite 的 `/api` 代理；生产环境使用对外服务地址。
- JSON 请求使用 `Content-Type: application/json`；这三个接口的请求体上限是 1 MiB。
- 配置了 `MICO_PUBLIC_ORIGIN` 或启用了 Entra 时，写请求必须带与服务规范源地址一致的 `Origin`。浏览器同源请求自动携带；脚本需要显式设置。
- `Host` 也受校验。不要通过随意替换域名、端口或手工伪造 `Host` 解决连接问题。
- 未启用登录时，可直接调用。启用 Entra 时，须先完成已有登录流程，并携带有效的 Mico 会话 cookie；白板 `token` 不替代登录。接口不提供独立的 API key 或直接使用 Entra Bearer token 的调用方式。
- 浏览器自定义客户端建议部署在同源。不能仅靠 `credentials: "include"` 从任意第三方网站调用；当前实现不承诺任意跨域、携带 cookie 的集成。
- **查询、创建、加入三个接口均不要携带 `X-Mico-Whiteboard` 或 `whiteboardSession`。** 它们用于进入房间前的操作。携带房间 token 反而会被房间权限检查拒绝，包括演示者会话。

以下 curl 示例面向匿名环境；需要登录的环境应由调用方安全管理已有 cookie，不能将 cookie 写入文档、源码或日志。

```sh
BASE_URL='http://127.0.0.1:7063'
```

### 安全边界

当前为**可信演示模式**：`sharer` 是调用方自报角色，不是经过独立授权的权限凭证。任何能访问服务的人都能请求演示者角色。启用 Entra 只限制谁能访问服务，所有获准身份仍可访问共享集合。

每块白板最多一个在线或预留中的演示者；其他人以参与者加入。服务器会限制参与者会话的写操作，但这不等于禁止该用户用新的会话申请演示者。不要将此机制用于需要严格主持人授权的产品。

## 3. 查询已有白板

```http
GET /api/whiteboards
```

无必填参数。返回 `200 OK`：

```json
{
	"whiteboards": [
		{
			"id": "41b753dd-8b78-43b6-9aa4-c0666595f385",
			"name": "Workshop",
			"revision": 0,
			"createdAt": "2026-11-16T02:00:00.000Z",
			"updatedAt": "2026-11-16T02:00:00.000Z"
		}
	]
}
```

```sh
curl --fail-with-body --silent --show-error \
  -H "Origin: $BASE_URL" \
  "$BASE_URL/api/whiteboards"
```

返回项字段：

| 字段                      | 类型         | 含义                                                          |
| ------------------------- | ------------ | ------------------------------------------------------------- |
| `id`                      | string       | 白板 ID；作为不透明字符串保存、传递，不要自行生成或从名称推断 |
| `name`                    | string       | 白板名称，不保证唯一                                          |
| `revision`                | number       | 白板内容修订号，不是在线人数                                  |
| `createdAt` / `updatedAt` | string       | ISO 8601 时间                                                 |
| `preview`                 | string，可选 | 创建响应可含 SVG data URL；当前列表接口不返回此字段           |

列表按 `updatedAt` 降序、`createdAt` 降序、`id` 升序排列。当前没有分页、名称筛选或在线人数/演示者状态字段；是否能成为演示者，以加入接口的结果为准。共享集合初始化时会创建默认空白板，因此新实例不一定返回空列表。

## 4. 创建白板

```http
POST /api/whiteboards
Content-Type: application/json

{"name":"Workshop"}
```

请求体必须是对象，只允许 `name` 字段：

| 字段   | 类型         | 规则                                                                               |
| ------ | ------------ | ---------------------------------------------------------------------------------- |
| `name` | string，可选 | 去除首尾空白后长度为 1–80，不允许 ASCII 控制字符或 DEL；省略时为 `Untitled canvas` |

建议始终显式提供名称。`{}` 可使用默认名称，但空字符串、`null`、额外的 `activate`、`username`、`sharer` 等字段不合法。

返回 `201 Created`：

```json
{
	"whiteboard": {
		"id": "41b753dd-8b78-43b6-9aa4-c0666595f385",
		"name": "Workshop",
		"revision": 0,
		"createdAt": "2026-11-16T02:00:00.000Z",
		"updatedAt": "2026-11-16T02:00:00.000Z"
	}
}
```

上例省略了可选的 `preview` 字段。新白板内容为空。创建**不会自动加入、占用演示者名额或切换已有客户端的活动白板**。

```sh
curl --fail-with-body --silent --show-error \
  -H "Origin: $BASE_URL" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Workshop"}' \
  "$BASE_URL/api/whiteboards"
```

创建不是幂等操作，也没有幂等键。重复提交会创建多个白板，即使名称相同。请求超时后不要无条件自动重试；先重新查询、展示可能已创建的白板，让调用方确认。

## 5. 使用链接加入 Mico 页面（推荐）

页面入口：

```text
/?whiteboards=1
/?whiteboardid=<白板ID>&username=<URL编码后的名字>&sharer=true
/?whiteboardid=<白板ID>&username=<URL编码后的名字>&sharer=false
```

`whiteboards=1` 打开查询、创建和加入界面；`whiteboardid` 打开指定白板。直接加入链接需要有效的 ID 和用户名。`sharer=true` 为演示者，`sharer=false` 为参与者；省略 `sharer` 时页面按 `false` 处理，不接受 `1`、`0`、`True` 等替代值。

使用标准 URL API，避免手工拼接名字导致空格、中文、`&` 等被错误解析：

```js
function buildWhiteboardUrl(baseUrl, whiteboardid, username, sharer) {
	const url = new URL('/', baseUrl)
	url.search = new URLSearchParams({
		whiteboardid,
		username,
		sharer: String(sharer),
	}).toString()
	return url.href
}

const presenterUrl = buildWhiteboardUrl(
	'http://127.0.0.1:7063',
	'41b753dd-8b78-43b6-9aa4-c0666595f385',
	'Jason Huang',
	true,
)
```

把地址作为链接交给用户点击，或在用户操作后导航。多窗口可能受到浏览器弹窗限制；不要承诺一次异步操作必然能打开多个窗口。

页面自行完成登录后的返回、加入、WebSocket 连接和重连。**链接不包含 `clientId` 或房间 `token`**。同一个白板可以为不同名字生成不同角色的链接；多个窗口应为一个演示者和若干参与者，而不是重复打开演示者链接。

## 6. 自定义客户端：加入接口

只有自行管理会话和 WebSocket 的客户端，才需要直接调用：

```http
POST /api/whiteboards/join
Content-Type: application/json

{
  "whiteboardid": "41b753dd-8b78-43b6-9aa4-c0666595f385",
  "username": "Jason Huang",
  "sharer": true,
  "clientId": "bb4f95c3-29e0-4a46-86b4-64c9c5e0da41"
}
```

所有字段必填，不允许额外字段：

| 字段           | 类型    | 规则                                                                        |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `whiteboardid` | string  | 长度 1–80，必须是共享集合中实际存在的 ID                                    |
| `username`     | string  | 去除首尾空白后长度 1–80，不允许 ASCII 控制字符或 DEL                        |
| `sharer`       | boolean | JSON 布尔值 `true` / `false`，不能传字符串 `"true"` / `"false"`             |
| `clientId`     | string  | 私有 UUID，建议 `crypto.randomUUID()`；每个独立客户端各生成一个，重连时复用 |

返回 `200 OK`，格式如下；`token`、`member.id` 和 `color` 的具体值由服务端生成：

```json
{
	"token": "<token>",
	"whiteboardid": "41b753dd-8b78-43b6-9aa4-c0666595f385",
	"member": {
		"id": "<服务端返回的成员ID>",
		"username": "Jason Huang",
		"sharer": true,
		"color": "#6844bd",
		"cursor": null
	}
}
```

`member.id` 是公开的成员标识，不是 `clientId`；不要使用它重新加入。用户名不是唯一标识。名字背景和鼠标均使用 `member.color`，颜色可能重复。首次加入时 `cursor` 为 `null`，复用仍存在的会话时可保留原光标状态。

调用示例（将 `WHITEBOARD_ID` 换为查询或创建返回的 ID）：

```sh
WHITEBOARD_ID='41b753dd-8b78-43b6-9aa4-c0666595f385'
CLIENT_ID="$(node -p 'crypto.randomUUID()')"
curl --fail-with-body --silent --show-error \
  -H "Origin: $BASE_URL" \
  -H 'Content-Type: application/json' \
  --data "{\"whiteboardid\":\"$WHITEBOARD_ID\",\"username\":\"Jason Huang\",\"sharer\":true,\"clientId\":\"$CLIENT_ID\"}" \
  "$BASE_URL/api/whiteboards/join"
```

此 curl 只演示加入请求，**不会建立在线连接**。不要先执行它占用演示者名额，再用另一份客户端身份打开 Mico 页面。

### 加入成功不等于在线

成功后应立即建立主连接：

```text
ws://<源地址>/api/events?whiteboardSession=<token>
wss://<源地址>/api/events?whiteboardSession=<token>
```

HTTP 页面使用 `ws`，HTTPS 页面使用 `wss`。浏览器 WebSocket 自动发送源地址及适用的 cookie；非浏览器客户端必须正确发送 `Origin`，并在启用登录时携带同一身份的 cookie。token 绑定加入时的登录身份，不能跨身份转用。

同源浏览器中的最小连接片段，假定 `session` 是刚收到的加入响应：

```js
const url = new URL('/api/events', window.location.origin)
url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
url.searchParams.set('whiteboardSession', session.token)
const socket = new WebSocket(url)

socket.addEventListener('message', (event) => {
	const message = JSON.parse(event.data)
	// 在这里分发 snapshot、board、presence、cursor、presenter-view。
	console.info('Whiteboard event', message.type)
})
socket.addEventListener('error', () => {
	console.error('Whiteboard connection failed')
})
socket.addEventListener('close', (event) => {
	console.info('Whiteboard disconnected', event.code, event.reason)
	// 生产客户端在这里更新离线状态，并按下一节处理重连或权限错误。
})
```

演示者主连接为 `OPEN` 后，才允许写入、AI 请求或语音连接。连接关闭后不再允许发起这些操作。

后续房间内 HTTP 请求使用：

```http
GET /api/state
X-Mico-Whiteboard: <token>
```

它返回加入的白板快照。**不要把这个 header 全局加到查询、创建或重新加入请求上**，也不要发送给第三方域名。token 是临时会话凭证，不要放入分享链接或日志；图片及 WebSocket 使用的带 token URL 同样应避免被日志记录。

### 接收事件

| `type`           | 内容与处理                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`       | `{activeCanvasId, stateVersion, canvases, board}`；初始化当前白板。`board` 为 `{revision, shapes}`，`canvases` 只包含当前白板 |
| `board`          | `{canvasId, canvas, board}`；当前房间的白板内容变更                                                                           |
| `presence`       | `{members, presenterId, viewport}`；替换在线成员列表，`members` 项结构与加入响应的 `member` 相同；后两项可能为 `null`         |
| `cursor`         | `{memberId, point}`；更新成员鼠标，`point` 为 `{x,y}` 或 `null`                                                               |
| `presenter-view` | `{viewport:{centerX,centerY,zoom}}`；演示者视角，坐标为白板世界坐标                                                           |

以上消息均还包含 `type` 字段。不要假定 `snapshot` 先于 `presence` 到达。加入接口的响应不是在线成员列表，UI 的在线状态应以 WebSocket 为准。

自定义客户端可发送 `{"type":"cursor","point":{"x":100,"y":200}}`，鼠标离开时发送 `{"type":"cursor","point":null}`。只有演示者可以发送 `{"type":"presenter-view","viewport":{"centerX":100,"centerY":200,"zoom":1}}`。坐标须为有限数且在 `[-1e9,1e9]` 内，缩放范围为 `0.05–3`；消息不允许额外字段，鼠标点必须同时包含 `x`、`y`。建议合并到每 50 ms 最多一次各类更新；服务端会丢弃间隔不足 15 ms 的同类更新，单条输入上限为 4096 字节。

自定义 UI 还需自行实现跟随与脱离：保存最新演示者视角；参与者手动平移/缩放后停止应用该视角，显示彩色边框和返回按钮；点击后恢复跟随。Mico 页面已实现这些行为，加入接口不会自动替外部 UI 完成它们。

## 7. 会话、重连与离开

1. 首次加入后，未连接的会话和演示者预留有效期为 10 秒。不要在服务端提前为未来所有用户批量加入。
2. 每个窗口/客户端使用不同的 `clientId`；同一身份、同一 `clientId` 只有一个主连接，新连接会关闭旧连接。
3. 短暂断线后复用原来的四个加入字段，再调用加入接口，使用新响应中的 token 连接；不要假定 token 永久不变。Mico 页面默认约每 2 秒重试。
4. 已连接客户端断线后，身份记录保留 60 秒；再次加入但尚未连接时，有效期重置为 10 秒。记录到期或守护进程重启后，需要重新建立会话。
5. 已存在的 `clientId` 不能直接更改白板、名字或角色；否则返回 `SESSION_CONFLICT`。主动更改这些信息时，先关闭旧连接，再使用新的 `clientId` 加入。
6. 没有独立的离开接口，关闭主 WebSocket 即离开；演示者名额在服务端处理断开时释放。异常掉线由约每 15 秒一次的 ping/pong 检查清理，不保证立即发现。
7. 如果原演示者断线后已有其他演示者接替，原会话重连会返回 `PRESENTER_EXISTS`，不能抢占。应提示用户等待，或由用户选择以新的参与者会话加入。
8. 每块白板最多 64 个保留中的会话，实例最多 512 个；未连接预留和断线保留记录也计数。不要通过循环生成新 `clientId` 绕过错误。

白板内容持久化到 SQLite；成员、token、光标和视角仅保存在单个守护进程的内存中。部署必须让相关 HTTP 与 WebSocket 访问同一实例；当前没有跨副本会话/广播协调。

## 8. 错误响应与调用方处理

HTTP 错误格式为：

```json
{
	"error": "PRESENTER_EXISTS",
	"message": "This whiteboard already has a presenter."
}
```

使用 HTTP 状态码与 `error` 判断，不要匹配 `message` 文本，也不要误以为错误码字段叫 `code`。

| HTTP | `error`                               | 处理                                                                                          |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| 400  | `INVALID_JSON`                        | 修正 JSON 编码                                                                                |
| 400  | `INVALID_REQUEST`                     | 检查字段拼写、类型、长度及多余字段；特别注意 JSON 的 `sharer` 必须为 boolean                  |
| 401  | `UNAUTHENTICATED`                     | 完成登录或恢复有效登录会话                                                                    |
| 401  | `WHITEBOARD_SESSION_EXPIRED`          | 后续房间请求的 token 已失效或身份不匹配；按重连流程重新加入                                   |
| 403  | `FORBIDDEN_HOST` / `FORBIDDEN_ORIGIN` | 检查服务地址、规范源与代理配置；不是更换白板 ID 能解决的问题                                  |
| 403  | `WHITEBOARD_READ_ONLY`                | 当前会话不允许此操作；也可能误把房间 token 带到了查询、创建、加入接口，或演示者主连接尚未在线 |
| 403  | `WHITEBOARD_SCOPE`                    | 房间请求指定了另一块白板；使用加入响应中的 ID                                                 |
| 404  | `NOT_FOUND`                           | 加入的共享白板不存在，或接口路径错误；重新查询并核对 ID                                       |
| 405  | `METHOD_NOT_ALLOWED`                  | 使用文档指定的 HTTP 方法                                                                      |
| 409  | `PRESENTER_EXISTS`                    | 已有在线或预留的演示者；提示用户，不能自动抢占或静默改成参与者                                |
| 409  | `SESSION_CONFLICT`                    | 现存 `clientId` 的加入信息发生变化，见上一节                                                  |
| 409  | `ROOM_FULL`                           | 白板保留会话已满；等待释放，不要无限重试                                                      |
| 413  | `PAYLOAD_TOO_LARGE`                   | 缩小请求体                                                                                    |
| 503  | `ROOMS_FULL`                          | 实例会话已满；稍后重试并向用户展示原因                                                        |
| 500  | `INTERNAL_ERROR`                      | 展示服务异常；查询可重试，创建先确认是否已成功                                                |

WebSocket 升级失败不保证返回同样的 JSON；当前加入凭证或角色检查失败时可直接拒绝握手为 HTTP `403`。已连接后收到关闭码 `1008` 应展示原因并停止盲目重试，例如参与者发送演示者视角、消息格式错误或演示者冲突。浏览器可能只能看到通用连接错误，此时检查登录状态，并重新调用加入接口获取可处理的 HTTP 错误。

## 9. 交给 Agent 的实现清单

```text
请依据 docs/shared-whiteboards-api.md 实现共享白板接入：
- 将 Mico 对外源地址做成配置，不硬编码临时演示地址。
- 用 GET /api/whiteboards 展示名字和 ID；以 ID 选择，不以名字作为唯一键。
- 用 POST /api/whiteboards 创建；防重复提交，保存返回 ID，不无条件重试创建。
- 若使用 Mico 页面：直接构造带 whiteboardid、username、sharer 的链接，不预先调用 join。
- 若实现自定义客户端：join 成功后立即连接 events；分开管理登录 cookie、clientId、token、member.id。
- 对查询/创建/join 不带房间 token；仅房间内请求带 X-Mico-Whiteboard。
- 每个独立窗口使用独立 clientId，重连复用；处理角色冲突、连接失败和离开。
- 展示 HTTP 错误，不静默降级角色，不假设当前模式提供严格主持人授权。
- 验收一个演示者与两个参与者加入同一 ID；验证名字/鼠标、同步、只读与跟随行为。
- 自动化验证使用隔离实例和数据库，不操作用户的日常白板。
```

可运行的“查询、创建、输出演示者链接”示例见 [`examples/shared-whiteboard.ts`](../examples/shared-whiteboard.ts)。只打开 Mico 页面时优先复用此流程。

实现依据：[`src/shared/whiteboards.ts`](../src/shared/whiteboards.ts)、[`src/server/whiteboards.ts`](../src/server/whiteboards.ts)、[`src/server/index.ts`](../src/server/index.ts)、[`src/server/store.ts`](../src/server/store.ts)。相关契约由 [`src/server/whiteboards.integration.test.ts`](../src/server/whiteboards.integration.test.ts) 覆盖。
