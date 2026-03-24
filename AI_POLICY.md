AI Policy
=========

AI tools are powerful, capable of handling deep implementation work, 
refactoring of entire subsystems, and catch things you'd miss at 2am. 
Signet is built with AI tools. AI helps us translate ideas and concepts
into code faster than we ever could alone, and we'd be fools not to use it.

However, the human behind the tool is responsible for understanding every 
decision, every architectural choice and why the implementation of the code
works the way that it does. And moreover, how their code fits into the broader
codebase as a whole. Powerful AI tools are not an excuse to stop thinking. 

If you can't explain why a change exists, how it works, and what breaks
if you remove it, it doesn't belong in your PR. Full stop. You are already
screwed, and should open an issue or start a discussion instead of burning 
your tokens.

Contributors should use AI freely. Claude Code, Cursor, Codex, anything is fine.  
But for the love of god, AI is your hands, not your brain. 

Read what it writes and Disclose it. All AI usage must be disclosed in your PR. 
Not because it's shameful, but because it's honest and helps maintainers 
understand contributions better. Include `Assisted-by` tags in your commit 
messages:

```
Assisted-by: Claude-Code:claude-opus-4-6
Assisted-by: Cursor:claude-sonnet-4-5 biome
```

Every PR is reviewed by humans. Sending unreviewed AI output to a
maintainer wastes their time validating work you didn't bother to
understand. That's not a contribution, that's a chore with extra steps.

Just because your AI is good at coding doesn't mean you get to shut
your brain off and let it freelance in your codebase like an idiot.
PRs that are clearly unreviewed slop will be closed. Repeat offenders
will be blocked. This project builds AI tooling — we know exactly what
these tools can and can't do. They are not a substitute for thinking.
