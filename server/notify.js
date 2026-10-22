/**
 * 消息通知模块 (Webhook)
 * 支持：企业微信群机器人、钉钉群机器人、飞书自定义机器人
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

function requestJson(urlStr, data) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const lib = isHttps ? https : http;
      const body = JSON.stringify(data);

      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 8000,
        },
        (res) => {
          let resData = '';
          res.on('data', (chunk) => (resData += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(resData);
              resolve(parsed);
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: resData });
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out'));
      });

      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function dingtalkSign(secret) {
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64');
  return { timestamp, sign: encodeURIComponent(sign) };
}

async function sendWebhook(settings, eventType, data) {
  const type = settings.webhook_type;
  let url = settings.webhook_url;
  const secret = settings.webhook_secret || '';

  if (!type || type === 'none' || !url) {
    return { ok: false, msg: 'Webhook not configured' };
  }

  try {
    let payload = null;
    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 构建消息文本与标题
    let title = '总务报修提醒';
    let text = '';

    if (eventType === 'ticket_create') {
      title = `📢 新报修申请【${data.urgency || '普通'}】`;
      text = `### 📢 新报修工单提交\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **报修地点**：${data.building} ${data.room}\n` +
        `- **故障类型**：${data.category}\n` +
        `- **紧急程度**：${data.urgency}\n` +
        `- **报修人员**：${data.reporter} (${data.identity || '人员'}) 📱 ${data.phone}\n` +
        `- **故障描述**：${data.desc}\n` +
        `- **提交时间**：${timeStr}\n\n` +
        `> 请总务处值班老师及时受理并指派维修师傅。`;
    } else if (eventType === 'ticket_assign') {
      title = `🔧 报修派工提醒【${data.assignee}】`;
      text = `### 🔧 报修工单已派工\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **地点**：${data.building} ${data.room}\n` +
        `- **指派师傅**：${data.assignee}\n` +
        `- **故障描述**：${data.desc}\n` +
        `- **派工备注**：${data.note || '无'}\n` +
        `- **派工时间**：${timeStr}\n\n` +
        `> 请师傅尽快前往现场核实处理。`;
    } else if (eventType === 'ticket_accept') {
      title = `👷 师傅已接单【${data.assignee}】`;
      text = `### 👷 维修师傅已接单到场\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **维修人员**：${data.assignee}\n` +
        `- **地点**：${data.building} ${data.room}\n` +
        `- **接单时间**：${timeStr}`;
    } else if (eventType === 'ticket_finish') {
      title = `✅ 维修已完工【待验收】`;
      text = `### ✅ 维修已完工，等待验收\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **地点**：${data.building} ${data.room}\n` +
        `- **维修人员**：${data.assignee}\n` +
        `- **处理结果**：${data.result}\n` +
        `- **完工时间**：${timeStr}\n\n` +
        `> 已通知报修人进行现场验收与评分。`;
    } else if (eventType === 'ticket_rate') {
      title = `⭐ 报修已评价结单`;
      text = `### ⭐ 报修工单已验收结单\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **报修人**：${data.reporter}\n` +
        `- **评价得分**：${'⭐'.repeat(data.score || 5)} (${data.score}分)\n` +
        `- **评价反馈**：${data.comment || '无'}\n` +
        `- **结单时间**：${timeStr}`;
    } else if (eventType === 'ticket_remind') {
      title = `⚠️ 报修加急催单提醒！`;
      text = `### ⚠️【加急催单】报修人正在催单！\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **报修地点**：${data.building} ${data.room}\n` +
        `- **报修人**：${data.reporter} 📱 ${data.phone}\n` +
        `- **当前状态**：${data.statusText || data.status}\n` +
        `- **当前负责人**：${data.assignee || '未派工'}\n` +
        `- **催单原因/备注**：${data.note || '加急催办'}\n` +
        `- **已累计催单**：${data.remindCount || 1} 次\n\n` +
        `> 请相关负责人优先关注并加紧落实！`;
    } else if (eventType === 'ticket_comment') {
      title = `💬 工单新留言【${data.senderName}】`;
      text = `### 💬 工单沟通新留言\n\n` +
        `- **工单编号**：${data.id}\n` +
        `- **留言人**：${data.senderName} (${data.senderRole})\n` +
        `- **地点**：${data.building} ${data.room}\n` +
        `- **留言内容**：${data.content}\n` +
        `- **时间**：${timeStr}`;
    } else if (eventType === 'test') {
      title = `🎉 总务报修系统 - Webhook 连接测试`;
      text = `### 🎉 总务报修系统通知测试\n\n` +
        `- **测试状态**：机器人 Webhook 配置成功！\n` +
        `- **推送通道**：${type}\n` +
        `- **测试时间**：${timeStr}\n\n` +
        `> 本地 Docker 版已就绪，所有报修、派工、完工及催单均可实时同步。`;
    }

    if (type === 'wecom') {
      // 企业微信群机器人 markdown
      payload = {
        msgtype: 'markdown',
        markdown: {
          content: text,
        },
      };
    } else if (type === 'dingtalk') {
      // 钉钉群机器人 markdown
      if (secret) {
        const { timestamp, sign } = dingtalkSign(secret);
        const joiner = url.includes('?') ? '&' : '?';
        url = `${url}${joiner}timestamp=${timestamp}&sign=${sign}`;
      }
      payload = {
        msgtype: 'markdown',
        markdown: {
          title: title,
          text: text,
        },
      };
    } else if (type === 'feishu') {
      // 飞书机器人 interactive card
      payload = {
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: title },
            template: eventType === 'ticket_remind' ? 'red' : 'blue',
          },
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: text,
              },
            },
          ],
        },
      };
    } else {
      // 通用 Webhook json
      payload = {
        event: eventType,
        title,
        text,
        timestamp: Date.now(),
        data,
      };
    }

    const res = await requestJson(url, payload);
    return { ok: true, res };
  } catch (err) {
    console.error(`[Webhook Error] [${type}]`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendWebhook,
};

