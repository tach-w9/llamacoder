import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { getMainCodingPrompt, softwareArchitectPrompt } from "@/lib/prompts";

const baseUrl = "https://g4f.space/api/pollinations/chat/completions";

export async function POST(request: NextRequest) {
  try {
    const { prompt, model, quality } = await request.json();

    const prisma = getPrisma();
    const chat = await prisma.chat.create({
      data: {
        model,
        quality,
        prompt,
        title: "",
        shadcn: true,
      },
    });

    async function fetchTitle() {
      const responseForChatTitle = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai-large",
          messages: [
            {
              role: "system",
              content:
                "You are a chatbot helping the user create a simple app or script, and your current job is to create a succinct title, maximum 3-5 words, for the chat given their initial prompt. Please return only the title.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });
      const data = await responseForChatTitle.json();
      const title = data.choices[0].message?.content || prompt;
      return title;
    }

    async function fetchTopExample() {
      const responseForExample = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai-large",
          messages: [
            {
              role: "system",
              content: `You are a helpful bot. Given a request for building an app, you match it to the most similar example provided. If the request is NOT similar to any of the provided examples, return "none". Here is the list of examples, ONLY reply with one of them OR "none":

            - landing page
            - blog app
            - quiz app
            - pomodoro timer
            `,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });
      const dataForExample = await responseForExample.json();

      const mostSimilarExample =
        dataForExample.choices[0].message?.content || "none";
      return mostSimilarExample;
    }

    const [title, mostSimilarExample] = await Promise.all([
      fetchTitle(),
      fetchTopExample(),
    ]);

    let userMessage: string;
    if (quality === "high") {
      const initialRes = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai-large",
          messages: [
            {
              role: "system",
              content: softwareArchitectPrompt,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.4,
          max_tokens: 3000,
        }),
      });

      const data = await initialRes.json();

      console.log("PLAN:", data.choices[0].message?.content);

      userMessage = data.choices[0].message?.content ?? prompt;
    } else {
      userMessage = prompt;
    }

    let newChat = await prisma.chat.update({
      where: {
        id: chat.id,
      },
      data: {
        title,
        messages: {
          createMany: {
            data: [
              {
                role: "system",
                content: getMainCodingPrompt(mostSimilarExample),
                position: 0,
              },
              { role: "user", content: userMessage, position: 1 },
            ],
          },
        },
      },
      include: {
        messages: true,
      },
    });

    const lastMessage = newChat.messages
      .sort((a, b) => a.position - b.position)
      .at(-1);
    if (!lastMessage) throw new Error("No new message");

    return NextResponse.json({
      chatId: chat.id,
      lastMessageId: lastMessage.id,
    });
  } catch (error) {
    console.error("Error creating chat:", error);
    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 },
    );
  }
}
