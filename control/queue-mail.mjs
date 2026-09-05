// 一次性脚本：向 emails 表插入一条 queued 邮件（mailer.mjs 5s 内领取并经 Gmail 发出）
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync(process.env.HOME + '/.mobileai/control.db');
const id = 'em_' + crypto.randomBytes(6).toString('hex');
const now = Date.now();

const subject = 'DSH 远程访问 · 新链接（newapi.email）';
const body = [
  'Ricky，你好：',
  '',
  '之前邮件里的链接（https://mai.newapi.email）存在 DNS 解析问题：',
  'Cloudflare 未为该隧道子域发布 A 记录，在部分网络（含国内）无法打开。',
  '',
  '请在手机浏览器直接打开以下新链接访问 DSH（全球可解析，无需任何 App）：',
  '',
  '    https://newapi.email/',
  '',
  '与之前同一个服务（mobile AI 控制面 / DSH 入口）。',
  '旧链接将在子域修复后恢复，届时可继续使用。',
  '',
  '— DSH Mobile AI',
].join('\n');

db.prepare('INSERT INTO emails (id,to_email,subject,body_text,status,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(id, 'xunricky@gmail.com', subject, body, 'queued', null, now, now);
console.log('queued:', id);
