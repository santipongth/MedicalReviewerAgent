# SPDX-License-Identifier: AGPL-3.0-or-later
"""Markup stripping shared by the MRA engine modules (not an engine itself).

Imported by the engines as ``searx.engines.mra_markup``. The same rules live in the backend's
``app/services/text.py`` (``strip_markup``); keep the two in step (a unit test compares them).

Only known tag names are treated as markup (HTML block/inline tags, JATS and MathML, with an
optional ``jats:``/``mml:`` prefix, and a strict attribute grammar), so clinical notation such
as "ALT <ULN in 40 patients and >3xULN in 12" or "p<0.001" survives intact.

Inline sub/superscript and font tags are joined with no space, as a plain-text reader (or a
copy-paste of the rendered page) sees them: "CO<sub>2</sub>" -> "CO2",
"10<jats:sup>9</jats:sup>/L" -> "109/L". Every other known tag becomes a space. Tags are
removed before entities are unescaped, so "&lt;" stays a literal "<".
"""

from __future__ import annotations

import html
import re

_INLINE_NAMES = r"sub|sup|i|b|em|strong|span|u|small|italic|bold|sc|underline|monospace"
_BLOCK_NAMES = (
    r"p|sec|title|abstract|br|hr|div|list|list-item|ext-link|xref|h[1-6]|a|label|ul|ol|li"
    r"|table|thead|tbody|tfoot|tr|td|th|caption|table-wrap|inline-formula|disp-formula"
    r"|named-content|break|math|mi|mo|mn|ms|mtext|mrow|msub|msup|msubsup|mfrac|msqrt|mroot"
    r"|mover|munder|munderover|mspace|mstyle|mtable|mtr|mtd|semantics|annotation"
)
_ATTRS = r"""(?:\s+[A-Za-z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*/?"""


def _tag(names: str) -> re.Pattern[str]:
    return re.compile(rf"<(?:/(?:(?:jats|mml):)?(?:{names})\s*|(?:(?:jats|mml):)?(?:{names}){_ATTRS})>",
                      re.IGNORECASE)


INLINE_TAG = _tag(_INLINE_NAMES)
BLOCK_TAG = _tag(_BLOCK_NAMES)


def clean_markup(value: object) -> str:
    if not value:
        return ""
    if isinstance(value, list):
        value = " ".join(str(v) for v in value)
    text = BLOCK_TAG.sub(" ", INLINE_TAG.sub("", str(value)))
    return " ".join(html.unescape(text).split())
