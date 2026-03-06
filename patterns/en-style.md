---
pack: en-style
language: en
name: Style Patterns
version: 1.0.0
patterns: 6
---

# Style Patterns

### 13. Em Dash Overuse

**Fire condition:** 3+ em dashes appear in a single text.

**Problem:** AI uses em dashes for emphasis, parenthetical asides, and clause breaks far more frequently than human writers. A text peppered with em dashes reads as distinctly AI-generated.

**Before:**
> The new policy — which was announced last Tuesday — aims to address a long-standing issue — affordable housing. Critics — including several council members — argue that the plan lacks specifics — a concern that the mayor dismissed as premature.

**After:**
> The new policy, announced last Tuesday, aims to address affordable housing. Several council members say the plan lacks specifics. The mayor called the criticism premature.

---

### 14. Boldface Overuse

**Problem:** AI bolds key terms as if writing a study guide or corporate slide deck. In normal prose, bolding should be rare or absent.

**Before:**
> **Machine learning** is a subset of **artificial intelligence** that uses **statistical methods** to enable computers to **learn from data**. The most common approaches include **supervised learning**, **unsupervised learning**, and **reinforcement learning**.

**After:**
> Machine learning is a subset of artificial intelligence that uses statistical methods to let computers learn from data. The three main approaches are supervised learning, unsupervised learning, and reinforcement learning.

---

### 15. Inline-Header Vertical Lists

**Problem:** AI converts prose into pseudo-heading bullet points with a bold label and colon on every item. This format is appropriate for reference docs but not for articles, essays, or narrative text.

**Before:**
> - **Accessibility:** The platform supports screen readers and keyboard navigation.
> - **Performance:** Load times have been reduced by 40%.
> - **Security:** All data is encrypted end-to-end.

**After:**
> The platform now supports screen readers and keyboard navigation, load times are down 40%, and all data is encrypted end-to-end.

---

### 16. Title Case in Headings

**Problem:** AI capitalizes every word in headings (Title Case) instead of using sentence case. In most modern style guides (AP, APA, Google developer docs), sentence case is preferred for readability.

**Before:**
> ## The Impact Of Remote Work On Urban Development And Housing Markets

**After:**
> ## The impact of remote work on urban development and housing markets

---

### 17. Emojis

**Watch words:** emojis used as section markers or emphasis

**Fire condition:** Any emoji in professional, academic, or editorial text.

**Problem:** AI inserts emojis to add visual interest to text where they are inappropriate. This is especially common in listicles, summaries, and instructional content.

**Before:**
> Here are five tips for better sleep:
> 1. Set a consistent bedtime
> 2. Avoid screens before bed
> 3. Keep your room cool
> 4. Limit caffeine after noon
> 5. Try reading instead of scrolling

**After:**
> Five tips for better sleep:
> 1. Set a consistent bedtime.
> 2. Avoid screens before bed.
> 3. Keep your room cool.
> 4. Limit caffeine after noon.
> 5. Read instead of scrolling.

---

### 18. Curly Quotation Marks

**Watch words:** curly/smart quotes used in contexts where straight quotes are standard

**Problem:** AI generates curly quotes in contexts where straight quotes are standard, such as code blocks, plain-text documents, configuration files, and technical documentation. This can cause syntax errors and compatibility issues.

**Before:**
> Set the variable: `name = "hello"`
>
> In your config file, add: `timeout = '30'`

**After:**
> Set the variable: `name = "hello"`
>
> In your config file, add: `timeout = '30'`
