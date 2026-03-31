---
pattern: 18
type: success
name: Curly Quotation Marks
pack: en-style
language: en
---

# Pattern 18 (en): Curly Quotation Marks — Success Case

## Input Text

> To connect to the database, update your environment file:
>
> ```bash
> export DB_HOST=\u201clocalhost\u201d
> export DB_PORT=\u201c5432\u201d
> export DB_NAME=\u201cmyapp_production\u201d
> ```
>
> Then verify the connection in your application code:
>
> ```python
> config.set(\u201ctimeout\u201d, \u201c30\u201d)
> config.set(\u201cretries\u201d, \u201c5\u201d)
> ```
>
> If the connection fails, check that `DB_HOST` matches your server\u2019s hostname.

## Expected Output

> To connect to the database, update your environment file:
>
> ```bash
> export DB_HOST="localhost"
> export DB_PORT="5432"
> export DB_NAME="myapp_production"
> ```
>
> Then verify the connection in your application code:
>
> ```python
> config.set("timeout", "30")
> config.set("retries", "5")
> ```
>
> If the connection fails, check that `DB_HOST` matches your server's hostname.

## Applied Pattern

- Pattern 18 (Curly Quotation Marks): Curly double quotes (\u201c \u201d) used inside bash export statements and Python function calls where straight quotes are syntactically required. Also a curly apostrophe (\u2019) in "server\u2019s" within a technical instruction sentence.

## Judgment

**Success** — The fire condition is clearly met: curly quotes appear inside code blocks (bash and Python) where they would cause syntax errors if copy-pasted. A shell will not parse `export DB_HOST=\u201clocalhost\u201d` correctly, and Python will raise a `SyntaxError` on `config.set(\u201ctimeout\u201d, \u201c30\u201d)`. The curly apostrophe in "server\u2019s" is also corrected to a straight apostrophe for consistency in a technical document. Every replacement is necessary for the code to function.
