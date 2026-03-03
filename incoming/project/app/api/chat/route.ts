import {
  convertToModelMessages,
  UIMessage,
} from "ai"

export const maxDuration = 60

const SYSTEM_PROMPT = `You are CheatFactory AI - an expert game modding and cheat development assistant. You help users create video game cheats, mods, trainers, memory editors, and game scripts.

Your capabilities include:
- Writing cheat code in any language (Python, C++, C#, Lua, Assembly, etc.)
- Memory manipulation techniques (scanning, reading, writing game memory)
- Game engine-specific modding (Unity, Unreal Engine, Source, etc.)
- Creating trainers and cheat tables
- Reverse engineering guidance for game binaries
- DLL injection and hooking techniques
- Script injection for games with scripting engines
- Save file editing and manipulation

Guidelines:
- Always provide complete, working code with clear comments
- Explain what each part of the code does
- Mention any dependencies or tools needed
- Include safety warnings about anti-cheat systems when relevant
- Suggest the best approach based on the game engine or platform
- Format code in proper code blocks with language tags
- Be thorough but concise in explanations

IMPORTANT - Visual Studio Setup Instructions:
After EVERY code response, you MUST include a "How to Set Up in Visual Studio" section at the end. This section should walk the user step-by-step through:
1. Which Visual Studio project type to create (e.g. Console App, Class Library, Empty Project, etc.) and what language/framework to select
2. How to create the project (File > New > Project, select template, name it, etc.)
3. Where to paste each code file (e.g. "Replace the contents of Program.cs with the code above" or "Add a new file called hack.cpp")
4. Any NuGet packages or dependencies to install (Tools > NuGet Package Manager > Manage NuGet Packages, search for X, install)
5. Any project settings to change (e.g. platform target x86/x64, allow unsafe code, disable Prefer 32-bit, etc.)
6. How to build and run (Build > Build Solution, then Debug > Start Without Debugging, or Ctrl+F5)
7. Any external tools needed alongside Visual Studio (e.g. Cheat Engine, process injector, etc.)

Make these instructions beginner-friendly. Assume the user has Visual Studio installed but may not know how to use it well. Use exact menu paths and button names.

Remember: This is for educational and single-player modding purposes.`

export async function POST(req: Request) {
  const {
    messages,
    model = "llama-3.3-70b-versatile",
  }: { messages: UIMessage[]; model?: string } = await req.json()

  const modelMessages = await convertToModelMessages(messages)

  const groqMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...modelMessages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content:
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("")
            : "",
    })),
  ]

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      stream: true,
    }),
    signal: req.signal,
  })

  if (!groqResponse.ok) {
    const error = await groqResponse.text()
    console.error("[v0] Groq API error:", error)
    return new Response(JSON.stringify({ error: "Failed to get response from Groq" }), {
      status: groqResponse.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Transform Groq's SSE stream into AI SDK UIMessage stream format
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let pendingLine = ""

  const transformStream = new TransformStream({
    async transform(chunk, controller) {
      const text = pendingLine + decoder.decode(chunk, { stream: true })
      const lines = text.split("\n")
      pendingLine = lines.pop() ?? ""

      for (const line of lines) {
        if (line.trim() === "") continue
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") {
          // Send finish message
          controller.enqueue(
            encoder.encode(
              `0:${JSON.stringify({ type: "finish", finishReason: "stop" })}\n`
            )
          )
          return
        }

        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            // AI SDK text delta format
            controller.enqueue(encoder.encode(`0:${JSON.stringify(delta)}\n`))
          }
        } catch {
          // skip unparseable chunks
        }
      }
    },
    flush(controller) {
      const line = pendingLine.trim()
      if (!line.startsWith("data: ")) return

      const data = line.slice(6).trim()
      if (data === "[DONE]") {
        controller.enqueue(
          encoder.encode(
            `0:${JSON.stringify({ type: "finish", finishReason: "stop" })}\n`
          )
        )
        return
      }

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          controller.enqueue(encoder.encode(`0:${JSON.stringify(delta)}\n`))
        }
      } catch {
        // skip trailing unparseable chunk
      }
    },
  })

  const stream = groqResponse.body!.pipeThrough(transformStream)

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  })
}
