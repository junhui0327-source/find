/**
 * Vercel 서버리스 함수: api/ask-ai.js
 * 
 * [목적]
 * 사용자가 분실/습득 관련 궁금한 점을 질문하면 OpenRouter API의
 * google/gemma-4-26b-a4b-it:free 모델이 친절하고 신속한 대처 요령을 답변합니다.
 */

module.exports = async function handler(req, res) {
  // 1. POST 요청 검증
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'POST 메서드만 지원해요.'
    });
  }

  // 2. 환경변수 확인
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelName = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return res.status(500).json({
      success: false,
      error: '.env.local 파일에 OPENROUTER_API_KEY를 설정해 주세요.'
    });
  }

  const { question } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({
      success: false,
      error: '질문 내용을 입력해 주세요.'
    });
  }

  try {
    // 3. 당근 스타일의 친절하고 전문적인 분실물 도우미 프롬프트
    const systemPrompt = `당신은 대한민국 동네 분실물 도우미 'FindIt AI'입니다.
사용자가 물건을 잃어버렸거나(분실) 주웠을 때(습득), 당황하지 않도록 따뜻하고 친절하게 단계별 행동 요령을 알려주세요.

[답변 원칙]
1. 말투: 당근마켓처럼 따뜻하고 친절한 이웃 말투 (~해요, ~해 보세요)를 사용하세요.
2. 실질적인 대처 순서(골든타임 행동, 연락처, 분실신고/카드정지/유실물센터 인계 등)를 번호를 매겨 명확하게 안내하세요.
3. 경찰청 Lost112, 대중교통 유실물센터 등 공식 채널을 적절히 안내하세요.
4. 너무 길지 않고 읽기 편하게 3~4개 핵심 단계로 요약해 주세요.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://findit.local',
        'X-Title': 'FindIt Ask'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question.trim() }
        ],
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[OpenRouter ask-ai 오류 응답]', response.status, errText);
      return res.status(response.status).json({
        success: false,
        error: `AI 답변 생성 중 일시적인 오류가 발생했어요 (${response.status}).`
      });
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || '죄송해요, 답변을 생성하지 못했어요. 다시 질문해 주세요.';

    return res.status(200).json({
      success: true,
      answer: answer
    });

  } catch (error) {
    console.error('[api/ask-ai 내부 오류]', error);
    return res.status(500).json({
      success: false,
      error: 'AI에게 질문하는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.'
    });
  }
};
