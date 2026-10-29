import anthropic from "../assets/providers/anthropic.svg?raw";
import claude from "../assets/providers/claude.svg?raw";
import openai from "../assets/providers/openai.svg?raw";

const MARKS = { anthropic, claude, openai };

/**
 * Official provider marks: Anthropic and OpenAI monochrome in the text colour,
 * the Claude mark in its brand colour (#D97757) for Claude models.
 */
export function ProviderLogo({ mark, size = 16 }: { mark: keyof typeof MARKS; size?: number }) {
  const svg = MARKS[mark].replace("<svg", `<svg width="${size}" height="${size}" fill="currentColor"`);
  return (
    <span
      className="provider-logo"
      style={{ width: size, height: size, color: mark === "claude" ? "#D97757" : undefined }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
