#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { z } from "zod";

const EMAIL = process.env.YAHOO_EMAIL;
const APP_PASSWORD = process.env.YAHOO_APP_PASSWORD;
const IMAP_HOST = process.env.YAHOO_IMAP_HOST || "imap.mail.yahoo.com";
const IMAP_PORT = Number(process.env.YAHOO_IMAP_PORT || 993);
const SMTP_HOST = process.env.YAHOO_SMTP_HOST || "smtp.mail.yahoo.com";
const SMTP_PORT = Number(process.env.YAHOO_SMTP_PORT || 465);

if (!EMAIL || !APP_PASSWORD) {
  console.error(
    "Missing YAHOO_EMAIL or YAHOO_APP_PASSWORD environment variables. " +
      "Set them (e.g. via your MCP client config's env block) before starting the server."
  );
  process.exit(1);
}

function openImapClient() {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: EMAIL, pass: APP_PASSWORD },
    logger: false,
  });
}

function summarizeMessage(msg, parsed) {
  return {
    uid: msg.uid,
    seq: msg.seq,
    subject: parsed.subject || "(no subject)",
    from: parsed.from?.text || "",
    to: parsed.to?.text || "",
    date: parsed.date ? parsed.date.toISOString() : null,
    snippet: (parsed.text || "").slice(0, 240),
  };
}

const tools = {
  list_emails: {
    description:
      "List recent emails in a Yahoo Mail folder (default INBOX), most recent first.",
    inputSchema: z.object({
      folder: z.string().default("INBOX"),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    jsonSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "IMAP folder name", default: "INBOX" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
    handler: async ({ folder, limit }) => {
      const client = openImapClient();
      await client.connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const total = client.mailbox.exists;
          if (total === 0) return { emails: [] };
          const start = Math.max(1, total - limit + 1);
          const results = [];
          for await (const msg of client.fetch(`${start}:${total}`, {
            envelope: true,
            source: true,
          })) {
            const parsed = await simpleParser(msg.source);
            results.push(summarizeMessage(msg, parsed));
          }
          results.reverse();
          return { emails: results };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },
  },

  search_emails: {
    description:
      "Search emails in a folder by sender, subject substring, or unseen status.",
    inputSchema: z.object({
      folder: z.string().default("INBOX"),
      from: z.string().optional(),
      subject: z.string().optional(),
      unseenOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    jsonSchema: {
      type: "object",
      properties: {
        folder: { type: "string", default: "INBOX" },
        from: { type: "string", description: "Filter by sender address/name" },
        subject: { type: "string", description: "Filter by subject substring" },
        unseenOnly: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
    handler: async ({ folder, from, subject, unseenOnly, limit }) => {
      const client = openImapClient();
      await client.connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const criteria = {};
          if (from) criteria.from = from;
          if (subject) criteria.subject = subject;
          if (unseenOnly) criteria.seen = false;
          const uids = await client.search(
            Object.keys(criteria).length ? criteria : { all: true }
          );
          const selected = uids.slice(-limit).reverse();
          const results = [];
          for (const uid of selected) {
            const msg = await client.fetchOne(uid, {
              envelope: true,
              source: true,
              uid: true,
            });
            if (!msg) continue;
            const parsed = await simpleParser(msg.source);
            results.push(summarizeMessage(msg, parsed));
          }
          return { emails: results };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },
  },

  get_email: {
    description: "Fetch the full content of one email by UID.",
    inputSchema: z.object({
      folder: z.string().default("INBOX"),
      uid: z.number().int(),
    }),
    jsonSchema: {
      type: "object",
      properties: {
        folder: { type: "string", default: "INBOX" },
        uid: { type: "integer", description: "Message UID from list_emails/search_emails" },
      },
      required: ["uid"],
    },
    handler: async ({ folder, uid }) => {
      const client = openImapClient();
      await client.connect();
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const msg = await client.fetchOne(uid, { source: true, uid: true });
          if (!msg) throw new Error(`No message with uid ${uid} in ${folder}`);
          const parsed = await simpleParser(msg.source);
          return {
            uid,
            subject: parsed.subject || "(no subject)",
            from: parsed.from?.text || "",
            to: parsed.to?.text || "",
            date: parsed.date ? parsed.date.toISOString() : null,
            text: parsed.text || "",
            html: parsed.html || null,
          };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },
  },

  send_email: {
    description: "Send an email from the configured Yahoo Mail account.",
    inputSchema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
    }),
    jsonSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async ({ to, subject, body, cc, bcc }) => {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: true,
        auth: { user: EMAIL, pass: APP_PASSWORD },
      });
      const info = await transporter.sendMail({
        from: EMAIL,
        to,
        cc,
        bcc,
        subject,
        text: body,
      });
      return { messageId: info.messageId, accepted: info.accepted };
    },
  },
};

const server = new Server(
  { name: "yahoo-mail-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.jsonSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = tools[name];
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const parsedArgs = tool.inputSchema.parse(args || {});
    const result = await tool.handler(parsedArgs);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
