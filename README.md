# yahoo-mail-mcp-server

An [MCP](https://modelcontextprotocol.io) server that gives Claude Desktop or
Claude Code access to a Yahoo Mail account over IMAP/SMTP: list, search, read,
and send email.

## Tools

| Tool | Description |
|---|---|
| `list_emails` | List recent emails in a folder (default `INBOX`), newest first. |
| `search_emails` | Search by sender, subject substring, or unseen status. |
| `get_email` | Fetch the full text/HTML body of one email by UID. |
| `send_email` | Send an email from the configured account. |

## 1. Generate a Yahoo App Password

Yahoo Mail requires an **app password**, not your normal account password, for
third-party IMAP/SMTP access:

1. Go to [Yahoo Account Security](https://login.yahoo.com/myaccount/security).
2. Enable two-step verification if it isn't already on.
3. Under "App passwords", generate a new one (e.g. name it `mcp-server`).
4. Copy the 16-character password — you won't be able to see it again.

Never use your real Yahoo login password here, and never commit it anywhere.

## 2. Install

```bash
git clone https://github.com/satishkovuru/yahoo-mail-mcp-server
cd yahoo-mail-mcp-server
npm install
```

## 3. Configure credentials

Copy `.env.example` to `.env` and fill in your address and app password:

```bash
cp .env.example .env
```

```
YAHOO_EMAIL=you@yahoo.com
YAHOO_APP_PASSWORD=your16charapppassword
```

`.env` is gitignored — never commit real credentials.

## 4. Wire it into Claude Desktop / Claude Code

Add an entry to your MCP client config
(`claude_desktop_config.json`, found under `%APPDATA%\Claude\` on Windows or
`~/Library/Application Support/Claude/` on macOS; for Claude Code use its
`.mcp.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "yahoo-mail": {
      "command": "node",
      "args": ["/absolute/path/to/yahoo-mail-mcp-server/src/index.js"],
      "env": {
        "YAHOO_EMAIL": "you@yahoo.com",
        "YAHOO_APP_PASSWORD": "your16charapppassword"
      }
    }
  }
}
```

Credentials belong in the `env` block of your local config file, which stays
on your machine — never in a file you commit to a repository.

Restart Claude Desktop (or restart your Claude Code session) and the
`yahoo-mail` tools will be available.

## Notes

- Uses [`imapflow`](https://github.com/postalsys/imapflow) for IMAP,
  [`nodemailer`](https://nodemailer.com/) for SMTP, and the official
  [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk).
- Default IMAP/SMTP hosts are Yahoo's (`imap.mail.yahoo.com`,
  `smtp.mail.yahoo.com`); override via `YAHOO_IMAP_HOST`, `YAHOO_IMAP_PORT`,
  `YAHOO_SMTP_HOST`, `YAHOO_SMTP_PORT` if needed.
- This project is not affiliated with or endorsed by Yahoo.
