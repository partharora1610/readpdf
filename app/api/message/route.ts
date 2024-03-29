import { currentUser } from "@clerk/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { sendMessageValidator } from "@/lib/validators";
import { db } from "@/db";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { pinecone } from "@/lib/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { openai } from "@/lib/openai";

import { OpenAIStream, StreamingTextResponse } from "ai";

export const POST = async (req: NextRequest, res: NextResponse) => {
  const body = await req.json();

  const user = await currentUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId, message } = sendMessageValidator.parse(body);

  const dbFile = await db.file.findFirst({
    where: {
      id: fileId,
      userId: user.id,
    },
  });

  if (!dbFile) {
    return new Response("Not Found", { status: 400 });
  }

  // Creating the message
  const dbMessage = await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      userId: user.id,
      fileId: dbFile.id,
    },
  });

  const openaiEmbeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY!,
  });

  const pineconeIndex = pinecone.Index("pdfgpt");

  const vectorStore = await PineconeStore.fromExistingIndex(openaiEmbeddings, {
    pineconeIndex,
    namespace: dbFile.id,
  });

  const results = await vectorStore.similaritySearch(message, 4);

  const previousMessages = await db.message.findMany({
    where: {
      fileId: dbFile.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 6,
  });

  const formattedMessages = previousMessages.map((message) => ({
    role: message.isUserMessage ? ("user" as const) : ("assistant" as const),
    content: dbMessage.text,
  }));

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    temperature: 0,
    stream: true,
    messages: [
      {
        role: "system",
        content:
          "Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format.",
      },
      {
        role: "user",
        content: `Use the following pieces of context (or previous conversaton if needed) to answer the users question in markdown format. \nIf you don't know the answer, just say that you don't know, don't try to make up an answer.
        
  \n----------------\n
  
  PREVIOUS CONVERSATION:
  ${formattedMessages.map((message) => {
    if (message.role === "user") return `User: ${message.content}\n`;
    return `Assistant: ${message.content}\n`;
  })}
  
  \n----------------\n
  
  CONTEXT:
  ${results.map((r) => r.pageContent).join("\n\n")}
  
  USER INPUT: ${message}`,
      },
    ],
  });

  // This is the stream
  const stream = OpenAIStream(response, {
    async onCompletion(completedMessage) {
      await db.message.create({
        data: {
          text: completedMessage,
          isUserMessage: false,
          userId: user.id,
          fileId: dbFile.id,
        },
      });
    },
  });

  return new StreamingTextResponse(stream);
};
