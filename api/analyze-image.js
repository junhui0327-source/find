/**
 * Vercel 서버리스 함수: api/analyze-image.js
 * 
 * [목적]
 * 사용자가 업로드한 분실물 사진(Base64)을 전달받아 OpenRouter API의
 * google/gemma-4-26b-a4b-it:free 모델로 분석하고,
 * 물품명, 카테고리, 색상, 고유 식별 특징을 구조화된 JSON 데이터로 반환합니다.
 */

module.exports = async function handler(req, res) {
  // 1. HTTP 메서드 검증 (POST 요청만 허용)
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'POST 메서드만 지원해요.'
    });
  }

  // 2. OpenRouter 환경변수 검증
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelName = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return res.status(500).json({
      success: false,
      error: '.env.local 파일에 유효한 OPENROUTER_API_KEY를 설정해 주세요.'
    });
  }

  // 3. 요청 바디 데이터 확인 (이미지 Base64)
  const { image } = req.body || {};
  if (!image) {
    return res.status(400).json({
      success: false,
      error: '분석할 이미지 데이터가 누락되었어요. 사진을 먼저 올려주세요.'
    });
  }

  try {
    // 4. OpenRouter API 프롬프트 구성 (Gemma 멀티모달 규격)
    const systemPrompt = `당신은 분실물 찾기 전문 AI 도우미 'FindIt'입니다.
업로드된 사진 속 분실물을 정밀하게 관찰하고, 반드시 아래의 JSON 형식으로만 응답해 주세요. 다른 설명이나 인사말 없이 순수 JSON만 출력하세요.

{
  "name": "물품의 구체적인 이름 (예: 에어팟 프로 2세대, 갈색 가죽 장지갑)",
  "category": "전자기기 | 지갑/카드 | 의류/패션 | 액세서리 | 서류/도서 | 열쇠/소지품 | 기타 중 하나",
  "color": "물품의 주요 색상 (예: 화이트, 네이비 블루)",
  "features": "물건을 다른 것과 구별할 수 있는 고유한 식별 특징 (예: 오른쪽 모서리 미세한 찍힘, 노란색 키링 부착, 특정 브랜드 로고 등)",
  "summary": "분실물에 대한 친절한 한 줄 요약 안내 (예: 파란 케이스가 씌워진 무선 이어폰이에요)"
}`;

    const requestPayload = {
      model: modelName,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: systemPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: image
              }
            }
          ]
        }
      ],
      temperature: 0.2
    };

    // 5. OpenRouter API 호출
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://findit.local',
        'X-Title': 'FindIt Lost and Found'
      },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[OpenRouter API 오류 응답]', response.status, errText);
      return res.status(response.status).json({
        success: false,
        error: `AI 분석 중 일시적인 오류가 발생했어요 (${response.status}). 잠시 후 다시 시도해 주세요.`
      });
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content || '';

    // 6. AI 응답 텍스트에서 JSON 추출 및 파싱
    let parsedData = null;
    try {
      // 마크다운 코드블록(```json ... ```) 제거 처리
      const cleanedJson = rawContent
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsedData = JSON.parse(cleanedJson);
    } catch (parseError) {
      console.warn('[JSON 파싱 실패, 원본 텍스트 활용]', rawContent);
      // 포맷이 정형화되지 않았을 경우 기본 텍스트 매핑
      parsedData = {
        name: '확인된 분실물',
        category: '기타',
        color: '알 수 없음',
        features: rawContent.slice(0, 200),
        summary: '사진 속 물품의 특징을 분석했어요.'
      };
    }

    // 7. 성공 결과 반환
    return res.status(200).json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    console.error('[api/analyze-image 내부 에러]', error);
    return res.status(500).json({
      success: false,
      error: '분실물 사진을 분석하는 과정에서 문제가 생겼어요. 다시 시도해 주세요.'
    });
  }
};
