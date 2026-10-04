// Mock API for design review and demos: serves the realistic fixture result and a slowly dripping live run.
//   node scripts/mock-api.mjs            (port 8100)
//   PUBLIC_API_URL=http://localhost:8100 npx next start -p 3110
// Node 24 strips the fixture's TypeScript types natively.
import http from "node:http";
import { emptyReviewFixture, reviewFixture } from "../src/test/fixtures.ts";

const PORT = Number(process.env.MOCK_API_PORT ?? 8100);
const LIVE_ID = "live-demo";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" };

const live = [
  ["started", { resume: false }], ["checking_topic", {}], ["refining", {}],
  ["question_refined", { refined_question: reviewFixture.result.question.refined_question,
    interpretation: reviewFixture.result.question.interpretation, sub_questions: reviewFixture.result.question.sub_questions, assumptions: ["เฉพาะผู้ใหญ่"] }],
  ["planning", { queries: ["metformin colorectal cancer"] }], ["searching", { found: 41 }], ["enriching", { candidates: 60 }],
  ["screening", { batch: 10 }], ["screened", { kept: 30, total: 60 }],
  ...reviewFixture.result.papers.slice(0, 4).flatMap((p) => [["reading", { ref: p.ref, title: p.title }],
    ["extracted", { ref: p.ref, ok: true, verified: 2, uncertain: p.ref === "P4" }]]),
];

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.method === "GET" && url.pathname === "/api/v1/reviews") {
    return send(res, 200, [{ id: reviewFixture.id, topic: reviewFixture.topic, language: "th", status: "done",
      created_at: reviewFixture.created_at, finished_at: reviewFixture.finished_at, verification_rate: 0.857 }]);
  }
  if (req.method === "POST" && url.pathname === "/api/v1/reviews") return send(res, 202, { review_id: LIVE_ID, status: "queued", cached: false });
  const m = url.pathname.match(/^\/api\/v1\/reviews\/([^/]+)(\/events)?$/);
  if (m && m[1] === LIVE_ID && !m[2]) return send(res, 200, { ...reviewFixture, id: LIVE_ID, status: "running", result: null });
  if (m && m[1] === LIVE_ID && m[2]) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors });
    for (let i = 0; i < live.length; i++) {
      res.write(`id: ${i + 1}\nevent: ${live[i][0]}\ndata: ${JSON.stringify({ ...live[i][1], elapsed_s: i * 3.5 })}\n\n`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    return; // keep the stream open: the run stays "reading" for review
  }
  if (m && m[1] === reviewFixture.id) return send(res, 200, reviewFixture);
  if (m && m[1] === "empty") return send(res, 200, { ...emptyReviewFixture, id: "empty" });
  return send(res, 404, { detail: "review not found" });
}).listen(PORT, () => console.log(`mock API on http://localhost:${PORT}`));
