import assert from "node:assert/strict"
import test from "node:test"
import { toIncomingRows } from "../src/whatsapp.js"

test("incoming document messages produce file attachment metadata", () => {
  const [row] = toIncomingRows({
    messages: [{
      key: { id: "doc-1", remoteJid: "ops@g.us", participant: "15551234567@s.whatsapp.net" },
      pushName: "Ari",
      messageTimestamp: 123,
      message: {
        documentMessage: {
          caption: "Schedule",
          fileName: "schedule.pdf",
          mimetype: "application/pdf",
          fileLength: 4096,
        },
      },
    }],
  })

  assert.equal(row.text, "Schedule")
  assert.equal(row.hasAttachment, true)
  assert.deepEqual(row.attachment, {
    fileName: "schedule.pdf",
    mimeType: "application/pdf",
    size: 4096,
    kind: "document",
  })
})

test("incoming media-only document messages still appear on the display", () => {
  const [row] = toIncomingRows({
    messages: [{
      key: { id: "doc-2", remoteJid: "ops@g.us" },
      messageTimestamp: 123,
      message: {
        documentMessage: {
          fileName: "incident.docx",
          mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      },
    }],
  })

  assert.equal(row.text, "[File] incident.docx")
  assert.equal(row.hasAttachment, true)
})
