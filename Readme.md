# Vybe Vigilante Bot (@vybe_v_bot)

**Your Intelligent AI Guide to the Solana Ecosystem**

Navigating the fast-paced world of Solana, with its thousands of tokens, wallets, and programs, can feel overwhelming. Data is scattered, trends shift in minutes, and making informed decisions requires constant vigilance.

**Enter Vybe Vigilante Bot:** An advanced AI-powered Telegram bot designed to be your indispensable co-pilot in the Solana universe. Powered by cutting-edge Large Language Models (LLMs), real-time data from the **Vybe Network API**, and a sophisticated memory system, Vybe Vigilante transforms complex blockchain data into clear, actionable insights, right within your Telegram chat.

[![Telegram Bot](https://img.shields.io/badge/Telegram-Vybe%20Vigilante-blue?logo=telegram)](https://t.me/vybe_v_bot)

---

## ✨ Core Features

Vybe Vigilante isn't just another crypto bot. It's an intelligent assistant capable of:

* 🧠 **Understanding Natural Language:** Ask questions about tokens, wallets, market trends, or specific program activity in plain English (or Spanish!).
* 📊 **Real-Time Data Analysis:** Fetches and interprets up-to-the-minute Solana data (prices, volume, holders, PnL, TVL, etc.) via the Vybe API.
* 🛠️ **Actionable Insights & Tool Usage:** Proactively uses a wide array of tools (function calls) to answer your questions with *real data*, not just generic knowledge. Need token recommendations? It fetches them. Want wallet PnL? It calculates it.
* 💾 **Persistent Memory & Personalization:** Remembers your preferences, favorite tokens, risk tolerance, and even complex trading strategies across conversations.
* 📈 **Trend Analysis & Prediction:** Analyzes historical data to identify trends and offers statistically-based price predictions (with disclaimers!).
* 🔔 **Custom Alerts:** Set up price alerts or schedule custom reminders.
* 🔍 **Semantic Search:** Recalls information from past conversations using vector search for unparalleled context awareness.
* 🤝 **Interactive Experience:** Provides responses with clear formatting and dynamic buttons for deeper exploration within Telegram.

---

## 🧠 The Magic: LLM, Tools & Advanced Memory

Vybe Vigilante leverages a powerful combination of technologies to deliver its intelligent capabilities:

### Function Calling (Tools): Real-Time Actions

The bot goes beyond the static knowledge of its base LLM. When you ask for specific, timely information (like a token's current price or the top trending tokens *right now*), the LLM intelligently selects and executes the appropriate "tool" (a predefined function). This ensures responses are grounded in **live data** from the Vybe API, covering areas like:

* **Token Intelligence:** Price, history, holders, volume, transfers, trends, recommendations, comparison.
* **Wallet Analysis:** Holdings (tokens/NFTs), PnL, historical balances, activity.
* **Program/Protocol Insights:** Details, active users, TVL, rankings.
* **Market Data:** Top tokens, market info, pair data (OHLCV).
* **User Interaction:** Alerts, memory storage/retrieval, semantic search.

### JSON Mode: Reliable Structured Data

To ensure consistency and enable rich interactions within Telegram (like displaying formatted data cards and dynamic buttons), the bot utilizes the LLM's **JSON Mode**. After executing tools, the LLM processes the raw data and returns a structured JSON object containing:

1.  `reply`: A user-friendly, natural language summary (in the user's language).
2.  `actionData`: The complete, unmodified structured data returned by the tool(s).
3.  `source`: Attribution indicating the data source (e.g., Vybe API endpoint).

This structured approach makes the bot's responses reliable and allows the `TelegramBotService` to present information effectively.

### Vybe API: The Solana Data Engine

All real-time on-chain data regarding tokens, wallets, programs, and market activity is sourced directly from the robust **Vybe Network API**. This ensures accuracy and relevance for navigating the Solana ecosystem.

### Advanced Memory System: A Persistent Mind

A key differentiator for Vybe Vigilante is its multi-layered memory system, allowing for truly personalized and context-aware interactions. This isn't just about remembering the last few messages; it's a sophisticated architecture designed for persistence and recall:

1.  **Short-Term Context (Working Memory):** The LLM automatically considers the most recent messages (`memoryContextSize`) within the current conversation turn (`sendMessage` context) to maintain immediate conversational flow.

2.  **Long-Term Key-Value Memory (Preferences & Facts):** Using the `MemoryItem` table (backed by Prisma and your database), the bot stores specific user preferences (like `risk_tolerance`, `investment_timeframe`, `favorite_tokens`) and facts (like `user_name`). Think of these as persistent "sticky notes" associated with the chat, allowing for personalized recommendations and interactions over time. Tools like `store_user_name` or `store_risk_tolerance` directly interact with this layer.

3.  **Structured Object Memory (Complex Data):** For more complex user-defined information, like detailed trading strategies (`upsert_trading_strategy`), watchlists (`upsert_token_watchlist`), or portfolio plans (`upsert_portfolio_plan`), the bot utilizes the `MemoryObject` table. This acts like a "file cabinet" where structured JSON data representing these complex concepts can be stored, retrieved (`retrieve_memory_objects`), and updated, providing a foundation for sophisticated financial planning and analysis within the chat.

4.  **Semantic (Vector) Memory (Conversational Recall):** Powered by **ChromaDB** and embedding models (like `text-embedding-3-small`), this layer allows the bot to understand the *meaning* behind past conversations.
    * The `actionResolveTokenAddresses` tool uses a dedicated ChromaDB collection (`token_resolution`) to quickly map user mentions of token names/symbols (e.g., "Solana", "SOL") to their actual on-chain addresses, crucial for accurate API calls.
    * The `semantic_query` tool searches indexed conversation history (or other data stored in ChromaDB, like cached API results) based on the *semantic meaning* of the user's query, not just keywords. This enables the bot to answer questions like "What did we discuss about JUP yesterday?" or "Find information related to high-risk tokens we talked about."
    * The `evaluate_query_intent` tool acts as a preliminary step, helping the LLM decide *if* a semantic search is the best approach and optimizing the query for ChromaDB.

This layered memory system allows Vybe Vigilante to build a rich, persistent understanding of the user and the conversation, leading to far more relevant, personalized, and intelligent interactions than a stateless bot.

---
## 💬 Usage Examples

Interact with the bot naturally on Telegram:

**Example 1: Basic Token Price**

> **You:** What's the price of SOL?

> **Vybe Vigilante:** (⏳ PROCESSING...)
>
> **Vybe Vigilante:**
> 🔶🔶🔶 **TOKEN SPOTLIGHT** 🔶🔶🔶
>
> **🪙 Solana** (`SOL`) ✅
>
> **💰 PRICE:** $175.32
> **📈 24H CHANGE:** **+3.15%**
>
> **📊 KEY METRICS**
> • Market Cap: **$81.2B**
> • 24h Volume: **$2.5B**
> • Holders: **1,234,567**
>
> **📍 ADDRESS:**
> `So1111...11112`
>
> ━...━
> \<i\>\#platform \#layer1\</i\>
>
> -----
>
> \<i\>Data from Vybe Network API\</i\>
>
> `[Buttons: 📊 History/Chart | 👥 Holders | 🔔 Alert | 🔍 Explorer]`

**Example 2: Token Recommendations**

> **You:** Recommend some high-risk, short-term trending meme tokens.

> **Vybe Vigilante:** (⏳ PROCESSING...)
>
> **Vybe Vigilante:**
> 🔥 **RECOMMENDED TRENDING TOKENS**
>
> \<i\>Risk Level: \<b\>high\</b\> • Timeframe: \<b\>short\</b\>\</i\>
>
> 🥇 **Dogwifhat** (`WIF`)
> 💰 Price: \<b\>$3.50\</b\> 🚀 \<b\>+15.82%\</b\>
> 📊 MCap: \<b\>$3.5B\</b\>
> \<i\>Based on criteria: trending...\</i\>
>
> 🥈 **Bonk** (`BONK`)
> 💰 Price: \<b\>$0.000035\</b\> 📈 \<b\>+8.10%\</b\>
> 📊 MCap: \<b\>$2.3B\</b\>
> \<i\>Based on criteria: trending...\</i\>
>
> ... (more tokens) ...
>
> -----
>
> \<i\>Data from Vybe Network API • Apr 29, 2025, 9:55 AM\</i\>
>
> `[Buttons: WIF | BONK | 🐶 Meme | 💰 DeFi | 🆕 New | ... ]`

**Example 3: Wallet Analysis**

> **You:** Analyze wallet `YourWalletAddressHere`

> **Vybe Vigilante:** (⏳ PROCESSING...)
>
> **Vybe Vigilante:**
> **💼 WALLET ANALYSIS**
>
> **Address:** `YourWa...ere`
>
> **📊 PORTFOLIO VALUE**
> • Total Value: \<b\>$12,345.67\</b\>
> • 24h Change: 📈 \<b\>+$567.89\</b\>
> • Tokens Held: \<b\>15\</b\>
> • NFT Collections: \<b\>3\</b\>
>
> **🏆 TOP HOLDINGS**
>
> 1.  `SOL`: 50.00
>     $8,766.00 ██████████▒▒▒▒▒▒▒▒▒▒ \<b\>71.0%\</b\>
> 2.  `JUP`: 1,000.00
>     $1,100.00 ██▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ \<b\>8.9%\</b\>
> 3.  `WIF`: 250.00
>     $875.00 ██▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ \<b\>7.1%\</b\>
>
> -----
>
> \<i\>Data provided by Vybe Network API • Apr 29, 2025, 9:56 AM\</i\>
>
> `[Buttons: 💰 Holdings | 📊 PnL | 🖼️ NFTs | 📝 Activity | 🌐 Explorer | 🔄 Trade]`

-----

## 🏗️ Architecture & Schema Overview

The bot is built with a modular architecture for clarity and maintainability:

  * **`TelegramBotService`:** Handles all interactions with the Telegram API (receiving messages, sending formatted responses, handling button callbacks). It acts as the User Interface layer.
  * **`ConversationService`:** The central orchestrator. It manages the conversation flow, interacts with the AI service, manages the multi-layered **memory system** (context, key-value, objects, semantic), handles **tool execution** logic, calls other services (Vybe, Chroma), and prepares the final response data.
  * **`AIService`:** A wrapper around the LLM provider's API (e.g., OpenAI). Handles sending prompts, history, tools, and receiving responses, including JSON mode and function calls.
  * **`VybeService`:** Interacts specifically with the Vybe Network API to fetch real-time Solana data.
  * **`ChromaService`:** (If implemented) Manages interactions with the ChromaDB vector database for semantic search and token resolution.
  * **`PrismaClient`:** Provides type-safe database access to manage users, chats, messages, memory items, memory objects, function calls, etc., based on the defined `schema.prisma`.

**Schema Highlights & Memory:**

The `schema.prisma` defines the structure for persistent storage:

  * `User`, `TelegramSession`, `Chat`, `Message`: Core entities for tracking users and conversations.
  * `MemoryItem`: Implements the **Key-Value Memory** layer for storing user preferences and simple facts (e.g., `user_name`, `risk_tolerance`).
  * `MemoryObject`: Implements the **Structured Object Memory** layer for storing complex, user-defined data like trading strategies or watchlists as JSON blobs.
  * `FunctionCall`: Logs requests made by the LLM to use specific tools, including arguments and results/errors.
  * `Token`: Stores basic token metadata, potentially including pre-computed embeddings and ChromaDB status for the **Semantic Memory** layer used in `actionResolveTokenAddresses`.
  * *(Other models support features like scheduled tasks, API call logging, etc.)*

This database structure, combined with ChromaDB for vector search, forms the backbone of the bot's advanced memory capabilities.

-----

## 🔮 Potential & Scalability

Vybe Vigilante is built with future growth in mind:

  * **Expand Toolset:** Easily add new tools to interact with more Vybe API endpoints or other data sources (e.g., news feeds, social sentiment).
  * **Deeper Analysis:** Implement more complex analysis functions combining data from multiple tools (e.g., correlating holder changes with price movements).
  * **Proactive Insights:** Develop scheduled tasks (`ScheduledTask`) to monitor wallets or tokens and proactively alert users about significant events.
  * **Enhanced Personalization:** Leverage the memory system more deeply to tailor responses and recommendations even further based on learned user behaviour and goals.
  * **Multi-LLM Support:** The `AIService` can be extended to support different LLM providers.
  * **Deployment:** The application structure is suitable for containerization (Docker) and deployment on cloud platforms (AWS, Google Cloud, Vercel, etc.).
  * **Scalability:** The database schema and service-oriented architecture allow for scaling components independently as usage grows.

-----

## 🏆 Hackathon Focus

Vybe Vigilante showcases:

  * **Novel AI Application:** Applying LLMs with advanced function calling and memory to the complex domain of blockchain data analysis.
  * **Technical Sophistication:** Implementing multi-layered memory, structured JSON output, real-time API integration, and potentially vector search.
  * **User Experience:** Providing a seamless, interactive, and informative experience directly within Telegram.
  * **Real-World Utility:** Solving a genuine problem for Solana users by simplifying data access and analysis.

-----

## 🤖 Try Vybe Vigilante Now\!

Experience the power of AI-driven Solana insights:

**[Start Chatting with @vybe\_v\_bot on Telegram](https://www.google.com/url?sa=E&source=gmail&q=https://t.me/vybe_v_bot)**

```
