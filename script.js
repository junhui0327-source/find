/**
 * 찾아줘. (FindIt) - 메인 프론트엔드 스크립트
 * 
 * [포함 기능]
 * 1. WORKSPACE 사이드바 네비게이션 및 브레드크럼 동기화
 * 2. 듀얼 인풋 검색 (물품명 + 분실장소) 및 검색 결과 피드 렌더링
 * 3. 최근 검색 기록 저장 및 '내 매칭 현황' 위젯 연동
 * 4. 분실물 등록: 사진 드래그&드롭 + OpenRouter AI 비전 분석 (/api/analyze-image)
 * 5. [핵심] 카테고리 매칭 알림 시스템 (새 습득물 등록 시 분실자에게 🔔 알림 발송)
 * 6. AI 탐정과 1:1 질의응답 (/api/ask-ai)
 */

document.addEventListener('DOMContentLoaded', () => {
  // =========================================================================
  // 1. 네비게이션 및 뷰 라우팅
  // =========================================================================
  const navItems = {
    home: document.getElementById('nav-item-home'),
    all: document.getElementById('nav-item-all'),
    map: document.getElementById('nav-item-map'),
    add: document.getElementById('nav-item-add'),
    ai: document.getElementById('nav-item-ai'),
    chat: document.getElementById('nav-item-chat'),
    history: document.getElementById('nav-item-history')
  };

  const views = {
    home: document.getElementById('view-home'),
    all: document.getElementById('view-all'),
    map: document.getElementById('view-map'),
    add: document.getElementById('view-add'),
    ai: document.getElementById('view-ai'),
    chat: document.getElementById('view-chat'),
    history: document.getElementById('view-history')
  };

  const breadcrumbCurrent = document.getElementById('breadcrumb-current');

  const viewNamesKo = {
    home: '홈',
    all: '전체 분실물 모아보기',
    map: '보관 장소 지도 (찾아가기)',
    add: '분실물 등록',
    ai: 'AI 탐정과 대화',
    chat: '이웃과 1:1 채팅',
    history: '내 기록'
  };

  function switchView(target) {
    Object.keys(views).forEach((key) => {
      if (key === target) {
        views[key].classList.remove('hidden');
        navItems[key]?.classList.add('active');
      } else {
        views[key].classList.add('hidden');
        navItems[key]?.classList.remove('active');
      }
    });

    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = viewNamesKo[target] || '홈';
    }

    if (target === 'home') {
      renderRecentSearches();
      updateMatchCount();
    } else if (target === 'all') {
      renderAllItemsFeed();
    } else if (target === 'map') {
      setupMapView();
    } else if (target === 'history') {
      renderHistoryView();
    } else if (target === 'chat') {
      renderChatRoomsList();
    }
  }

  // 사이드바 클릭 이벤트
  Object.keys(navItems).forEach((key) => {
    navItems[key]?.addEventListener('click', () => switchView(key));
  });

  // 히어로 버튼 및 빠른 링크 이벤트
  document.getElementById('btn-hero-start')?.addEventListener('click', () => switchView('add'));
  document.getElementById('btn-hero-ai')?.addEventListener('click', () => switchView('ai'));
  document.getElementById('btn-quick-new-lost')?.addEventListener('click', () => switchView('add'));
  document.getElementById('btn-quick-ask')?.addEventListener('click', () => switchView('ai'));
  document.getElementById('link-detail-search')?.addEventListener('click', (e) => { e.preventDefault(); switchView('all'); });
  document.getElementById('link-report-continue')?.addEventListener('click', (e) => { e.preventDefault(); switchView('all'); });

  // =========================================================================
  // 2. 로컬스토리지 키 및 기본 데이터
  // =========================================================================
  const KEY_ITEMS = 'findit_registered_items';
  const KEY_SEARCHES = 'findit_recent_searches';
  const KEY_NOTIS = 'findit_notifications';
  const KEY_SUBSCRIBED = 'findit_subscribed_categories';

  function getStoredItems() {
    const raw = localStorage.getItem(KEY_ITEMS);
    if (!raw) {
      // 초기 데모 데이터
      const initialData = [
        {
          id: 'item_demo_1',
          mode: 'found',
          name: '에어팟 프로 2세대 본체',
          category: '전자기기',
          color: '화이트',
          features: '곰돌이 푸우 스티커가 부착된 투명 케이스',
          location: '강남역 11번 출구 벤치',
          time: '오늘 오전 10시경',
          imageUrl: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=240&auto=format&fit=crop&q=80',
          createdAt: new Date().toISOString()
        },
        {
          id: 'item_demo_2',
          mode: 'lost',
          name: '갈색 가죽 카드지갑',
          category: '지갑/카드',
          color: '브라운',
          features: '내부에 신한카드 및 학생증 보관되어 있음',
          location: '서초동 스타벅스 인근',
          time: '어제 저녁 8시경',
          imageUrl: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=240&auto=format&fit=crop&q=80',
          createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
        }
      ];
      localStorage.setItem(KEY_ITEMS, JSON.stringify(initialData));
      return initialData;
    }
    return JSON.parse(raw);
  }

  // 매칭 건수 통계 갱신
  function updateMatchCount() {
    const items = getStoredItems();
    const statEl = document.getElementById('stat-match-count');
    if (statEl) {
      const lostCount = items.filter(i => i.mode === 'lost').length;
      statEl.textContent = String(lostCount).padStart(2, '0');
    }
  }

  // =========================================================================
  // 3. 듀얼 인풋 퀵 서치 & 최근 검색어
  // =========================================================================
  const homeKeywordInput = document.getElementById('home-search-keyword');
  const homeLocationInput = document.getElementById('home-search-location');
  const btnHomeSearch = document.getElementById('btn-home-search');
  const searchResultSection = document.getElementById('search-result-section');
  const searchResultTitle = document.getElementById('search-result-title');
  const searchResultList = document.getElementById('search-result-list');
  const btnCloseSearchResult = document.getElementById('btn-close-search-result');
  const homeRecentList = document.getElementById('home-recent-list');
  const btnClearRecentAll = document.getElementById('btn-clear-recent-all');

  function getRecentSearches() {
    const raw = localStorage.getItem(KEY_SEARCHES);
    if (!raw) {
      const initial = [{ query: '무선이어폰 검색', date: '2026.11.10' }];
      localStorage.setItem(KEY_SEARCHES, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw);
  }

  function addRecentSearch(query) {
    if (!query || !query.trim()) return;
    const clean = query.trim();
    let searches = getRecentSearches();
    searches = [{ query: clean, date: getTodayString() }, ...searches.filter(s => s.query !== clean)].slice(0, 5);
    localStorage.setItem(KEY_SEARCHES, JSON.stringify(searches));
    renderRecentSearches();
  }

  function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  }

  function renderRecentSearches() {
    if (!homeRecentList) return;
    const searches = getRecentSearches();
    if (searches.length === 0) {
      homeRecentList.innerHTML = '<div style="font-size:0.8rem; color:#8e9c94; text-align:center; padding:10px 0;">최근 검색 내역이 없어요.</div>';
      return;
    }

    homeRecentList.innerHTML = searches.map(s => `
      <div class="recent-item-row" data-query="${escapeHtml(s.query)}">
        <div class="recent-item-left">
          <span class="recent-glass">🔍</span>
          <span class="recent-word">${escapeHtml(s.query)}</span>
        </div>
        <span class="recent-date">${s.date}</span>
      </div>
    `).join('');
  }

  function performSearch(keyword, location = '') {
    const combinedQuery = `${keyword} ${location}`.trim();
    if (!combinedQuery) return;

    addRecentSearch(combinedQuery);

    const items = getStoredItems();
    const kwLower = keyword.toLowerCase().trim();
    const locLower = location.toLowerCase().trim();

    const filtered = items.filter(item => {
      const nameMatch = kwLower ? item.name.toLowerCase().includes(kwLower) || item.category.toLowerCase().includes(kwLower) || item.features.toLowerCase().includes(kwLower) : true;
      const locMatch = locLower ? (item.location && item.location.toLowerCase().includes(locLower)) : true;
      return nameMatch && locMatch;
    });

    searchResultTitle.textContent = `"${combinedQuery}" 탐색 결과 (${filtered.length}건)`;
    searchResultSection.classList.remove('hidden');

    if (filtered.length === 0) {
      searchResultList.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px; background:#fff; border-radius:12px; color:#6a7770;">일치하는 분실물/습득물이 아직 없어요. 새로운 단서로 검색해 보세요.</div>';
    } else {
      searchResultList.innerHTML = filtered.map(item => `
        <div class="result-card-box">
          <div class="res-card-top">
            <span class="${item.mode === 'lost' ? 'res-tag-lost' : 'res-tag-found'}">
              ${item.mode === 'lost' ? '😢 잃어버렸어요' : '🎁 주웠어요'}
            </span>
            <span style="font-size:0.75rem; color:#8e9c94;">${escapeHtml(item.category)}</span>
          </div>
          <div class="res-card-name">${escapeHtml(item.name)}</div>
          <div class="res-card-loc">📍 ${escapeHtml(item.location || '위치 미기재')} · ${escapeHtml(item.time || '최근')}</div>
          <div class="res-card-desc">${escapeHtml(item.features || item.summary || '')}</div>
          <button type="button" class="btn-chat-action" data-item-id="${item.id}">
            💬 ${item.mode === 'lost' ? '분실자에게 연락하기' : '습득자와 대화하기'}
          </button>
        </div>
      `).join('');
    }

    searchResultSection.scrollIntoView({ behavior: 'smooth' });
  }

  btnHomeSearch?.addEventListener('click', () => {
    performSearch(homeKeywordInput.value, homeLocationInput.value);
  });

  homeKeywordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(homeKeywordInput.value, homeLocationInput.value);
  });
  homeLocationInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(homeKeywordInput.value, homeLocationInput.value);
  });

  btnCloseSearchResult?.addEventListener('click', () => {
    searchResultSection.classList.add('hidden');
  });

  // 추천 태그 칩 클릭
  document.querySelectorAll('.quick-tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const kw = btn.dataset.kw;
      homeKeywordInput.value = kw;
      performSearch(kw, homeLocationInput.value);
    });
  });

  // 최근 검색 항목 클릭
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.recent-item-row');
    if (row) {
      const q = row.dataset.query;
      homeKeywordInput.value = q;
      performSearch(q);
    }
  });

  btnClearRecentAll?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.setItem(KEY_SEARCHES, JSON.stringify([]));
    renderRecentSearches();
  });

  // =========================================================================
  // 4. 알림 시스템 (🔔 카테고리 매칭 알림)
  // =========================================================================
  const btnNotiBell = document.getElementById('btn-noti-bell');
  const notiBadgeDot = document.getElementById('noti-badge-dot');
  const notiDropdown = document.getElementById('noti-dropdown');
  const notiDropdownBody = document.getElementById('noti-dropdown-body');
  const btnClearAllNoti = document.getElementById('btn-clear-all-noti');

  function updateNotiUI() {
    const notis = JSON.parse(localStorage.getItem(KEY_NOTIS) || '[]');
    const unread = notis.filter(n => !n.isRead).length;

    if (unread > 0) {
      notiBadgeDot?.classList.remove('hidden');
    } else {
      notiBadgeDot?.classList.add('hidden');
    }

    if (!notiDropdownBody) return;
    if (notis.length === 0) {
      notiDropdownBody.innerHTML = '<div class="empty-noti-msg">아직 새로운 알림이 없어요.</div>';
    } else {
      notiDropdownBody.innerHTML = notis.map(n => `
        <div class="noti-card-item">
          <div class="noti-card-title">${escapeHtml(n.title)}</div>
          <div style="color:#19201d; margin-top:2px;">${escapeHtml(n.message)}</div>
          <div style="font-size:0.7rem; color:#8e9c94; margin-top:4px;">${n.time}</div>
        </div>
      `).join('');
    }
  }

  btnNotiBell?.addEventListener('click', (e) => {
    e.stopPropagation();
    notiDropdown?.classList.toggle('hidden');
    const notis = JSON.parse(localStorage.getItem(KEY_NOTIS) || '[]');
    notis.forEach(n => n.isRead = true);
    localStorage.setItem(KEY_NOTIS, JSON.stringify(notis));
    updateNotiUI();
  });

  document.addEventListener('click', (e) => {
    if (notiDropdown && !notiDropdown.contains(e.target) && !btnNotiBell.contains(e.target)) {
      notiDropdown.classList.add('hidden');
    }
  });

  btnClearAllNoti?.addEventListener('click', () => {
    localStorage.setItem(KEY_NOTIS, JSON.stringify([]));
    updateNotiUI();
  });

  function pushNotification(title, message, targetId) {
    const notis = JSON.parse(localStorage.getItem(KEY_NOTIS) || '[]');
    notis.unshift({
      id: 'noti_' + Date.now(),
      title,
      message,
      targetId,
      isRead: false,
      time: '방금 전'
    });
    localStorage.setItem(KEY_NOTIS, JSON.stringify(notis.slice(0, 20)));
    updateNotiUI();
  }

  // =========================================================================
  // 5. 분실물 등록 & AI 비전 분석 (/api/analyze-image)
  // =========================================================================
  const regDropzone = document.getElementById('reg-dropzone');
  const regFileInput = document.getElementById('reg-file-input');
  const regDropEmpty = document.getElementById('reg-dropzone-empty');
  const regDropPreview = document.getElementById('reg-dropzone-preview');
  const regPreviewImg = document.getElementById('reg-preview-img');
  const regPreviewFilename = document.getElementById('reg-preview-filename');
  const regPreviewFilesize = document.getElementById('reg-preview-filesize');
  const btnRegRemoveImg = document.getElementById('btn-reg-remove-img');
  const btnRegAnalyze = document.getElementById('btn-reg-analyze');
  const regAiLoading = document.getElementById('reg-ai-loading');
  const regAiResult = document.getElementById('reg-ai-result');

  const tabRegLost = document.getElementById('tab-reg-lost');
  const tabRegFound = document.getElementById('tab-reg-found');
  let currentRegMode = 'lost';
  let regBase64Image = null;

  tabRegLost?.addEventListener('click', () => {
    currentRegMode = 'lost';
    tabRegLost.classList.add('active');
    tabRegFound.classList.remove('active');
  });

  tabRegFound?.addEventListener('click', () => {
    currentRegMode = 'found';
    tabRegFound.classList.add('active');
    tabRegLost.classList.remove('active');
  });

  regDropzone?.addEventListener('click', (e) => {
    if (e.target.closest('#btn-reg-remove-img') || !regDropPreview.classList.contains('hidden')) return;
    regFileInput.click();
  });

  regFileInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleUploadFile(e.target.files[0]);
  });

  regDropzone?.addEventListener('dragover', (e) => { e.preventDefault(); regDropzone.style.borderColor = '#1e3d34'; });
  regDropzone?.addEventListener('dragleave', (e) => { e.preventDefault(); regDropzone.style.borderColor = '#cfdcd3'; });
  regDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    regDropzone.style.borderColor = '#cfdcd3';
    if (e.dataTransfer?.files?.[0]) handleUploadFile(e.dataTransfer.files[0]);
  });

  function handleUploadFile(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('JPG, PNG, WEBP 이미지만 업로드 가능해요.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      regBase64Image = e.target.result;
      regPreviewImg.src = regBase64Image;
      regPreviewFilename.textContent = file.name;
      regPreviewFilesize.textContent = (file.size / 1024).toFixed(1) + ' KB';
      regDropEmpty.classList.add('hidden');
      regDropPreview.classList.remove('hidden');
      btnRegAnalyze.removeAttribute('disabled');
      regAiResult.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  btnRegRemoveImg?.addEventListener('click', (e) => {
    e.stopPropagation();
    regBase64Image = null;
    regFileInput.value = '';
    regDropPreview.classList.add('hidden');
    regDropEmpty.classList.remove('hidden');
    btnRegAnalyze.setAttribute('disabled', 'true');
    regAiResult.classList.add('hidden');
  });

  // AI 분석 요청
  btnRegAnalyze?.addEventListener('click', async () => {
    if (!regBase64Image) return;
    regAiLoading.classList.remove('hidden');
    regAiResult.classList.add('hidden');
    btnRegAnalyze.setAttribute('disabled', 'true');

    try {
      const res = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: regBase64Image })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'AI 분석에 실패했어요.');

      const item = data.data;
      document.getElementById('ai-item-name').value = item.name || '';
      document.getElementById('ai-item-category').value = item.category || '기타';
      document.getElementById('ai-item-color').value = item.color || '';
      document.getElementById('ai-item-features').value = item.features || '';

      regAiResult.classList.remove('hidden');
    } catch (err) {
      console.warn('[AI 분석 API 불가, 수동 입력 모드로 전환]:', err.message);
      // 서버 미구동 상태에서도 사용자가 멈추지 않고 등록할 수 있도록 폼 활성화
      document.getElementById('ai-item-name').value = '확인된 분실물';
      document.getElementById('ai-item-category').value = '전자기기';
      document.getElementById('ai-item-color').value = '화이트/블랙';
      document.getElementById('ai-item-features').value = '사진 속 물품의 외관 특징을 직접 수정하여 등록할 수 있어요.';
      regAiResult.classList.remove('hidden');

      alert(`[안내] ${err.message}\n직접 물품 정보를 수정하여 등록을 완료할 수 있습니다.\n(실제 OpenRouter 연동은 'npm run dev' 실행 및 .env.local API 키 입력 시 동작합니다.)`);
    } finally {
      regAiLoading.classList.add('hidden');
      btnRegAnalyze.removeAttribute('disabled');
    }
  });

  // 등록 완료 & 카테고리 매칭 알림 발송
  document.getElementById('btn-complete-register')?.addEventListener('click', () => {
    const name = document.getElementById('ai-item-name').value.trim();
    const category = document.getElementById('ai-item-category').value.trim() || '기타';
    const color = document.getElementById('ai-item-color').value.trim();
    const features = document.getElementById('ai-item-features').value.trim();
    const location = document.getElementById('reg-input-loc').value.trim() || '위치 미기재';
    const time = document.getElementById('reg-input-time').value.trim() || '최근';

    if (!name) {
      alert('물품명을 입력해 주세요.');
      return;
    }

    const newItem = {
      id: 'item_' + Date.now(),
      mode: currentRegMode,
      name,
      category,
      color,
      features,
      location,
      time,
      imageUrl: regBase64Image,
      createdAt: new Date().toISOString()
    };

    const items = getStoredItems();
    items.unshift(newItem);
    localStorage.setItem(KEY_ITEMS, JSON.stringify(items));

    // [카테고리 매칭 알림 엔진]
    let subscribed = JSON.parse(localStorage.getItem(KEY_SUBSCRIBED) || '[]');
    if (currentRegMode === 'lost') {
      if (!subscribed.includes(category)) {
        subscribed.push(category);
        localStorage.setItem(KEY_SUBSCRIBED, JSON.stringify(subscribed));
      }
      alert(`[${name}] 분실물이 등록되었어요!\n이웃이 '${category}' 카테고리의 습득물을 올리면 자동으로 매칭 알림을 드릴게요 🔔`);
    } else {
      if (subscribed.includes(category)) {
        pushNotification(
          `🔔 잃어버리신 '${category}' 관련 습득물이 등록되었어요!`,
          `이웃이 [${name}] 물건을 '${location}'에서 주웠다고 등록했어요. 확인해 보세요!`,
          newItem.id
        );
      }
      alert(`[${name}] 습득물이 등록되었어요!\n동일한 카테고리를 찾고 있는 이웃들에게 실시간 매칭 알림이 전달되었습니다 🎉`);
    }

    // 폼 초기화 및 홈 뷰 전환
    regBase64Image = null;
    regFileInput.value = '';
    regDropPreview.classList.add('hidden');
    regDropEmpty.classList.remove('hidden');
    regAiResult.classList.add('hidden');
    document.getElementById('reg-input-loc').value = '';
    document.getElementById('reg-input-time').value = '';
    switchView('home');
  });

  // =========================================================================
  // 6. AI 탐정과 대화 (/api/ask-ai)
  // =========================================================================
  const aiChatBox = document.getElementById('ai-chat-box');
  const aiChatInput = document.getElementById('ai-chat-input');
  const btnAiChatSend = document.getElementById('btn-ai-chat-send');

  function appendChatMsg(text, isAi = false) {
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${isAi ? 'msg-ai' : 'msg-user'}`;
    bubble.textContent = text;
    aiChatBox.appendChild(bubble);
    aiChatBox.scrollTop = aiChatBox.scrollHeight;
    return bubble;
  }

  /**
   * 스마트 모의 답변 생성기 (서버 미구동 또는 API 키 미입력 시에도 즉시 체험 가능)
   */
  function getSmartFallbackAnswer(question) {
    const q = question.toLowerCase();
    if (q.includes('지하철') || q.includes('가방') || q.includes('열차')) {
      return `[AI 탐정 긴급 가이드 🚇]\n당황하지 마세요! 지하철 유실물은 다음 3단계로 신속하게 찾을 수 있어요.\n\n1. 열차 번호와 하차 시간 확인: 승강장 바닥에 적힌 탑승 칸 번호(예: 3-2)와 내린 시각을 메모하세요.\n2. 즉시 고객안전실(역무실) 방문: 열차가 아직 운행 중이라면 역무원이 다음 역 승무원에게 무전으로 수색을 요청해 줍니다.\n3. 지하철 유실물센터 및 Lost112 조회: 종착역에 도달한 유실물은 당일 저녁 유실물센터로 인계되며 'Lost112' 포털에 등록됩니다.`;
    }
    if (q.includes('지갑') || q.includes('카드')) {
      return `[AI 탐정 긴급 가이드 💳]\n지갑 분실 시 2차 피해를 막기 위한 골든타임 행동 순서예요.\n\n1. 카드사 즉시 일시정지: 스마트폰 앱이나 대표번호로 체크/신용카드 결제 기능을 일시정지하세요.\n2. 신분증 분실 신고: 정부24에서 주민등록증, 도로교통공단에서 운전면허증 분실 신고를 진행하세요.\n3. 경찰청 유실물 포털(Lost112) 등록: 습득자가 경찰서에 맡기면 알림이 오도록 분실 신고서를 접수하세요.`;
    }
    if (q.includes('스마트폰') || q.includes('휴대폰') || q.includes('아이폰') || q.includes('갤럭시')) {
      return `[AI 탐정 긴급 가이드 📱]\n전원이 꺼졌거나 분실한 스마트폰 대처 요령이에요.\n\n1. 위치 추적 실행: 삼성 SmartThings Find 또는 애플 나의 찾기(iCloud)에서 마지막 확인 위치를 조회하세요.\n2. 분실 모드(분실 잠금) 활성화: 화면에 비상 연락처를 띄워 습득자가 연락할 수 있게 설정하세요.\n3. 통신사 분실 접수: 발신 정지 처리 및 기기 고유번호(IMEI)를 통한 분실 등록을 진행하세요.`;
    }
    return `[AI 탐정 답변 🔍]\n"${question}"에 대해 안내해 드릴게요.\n\n1. 마지막으로 물건을 확인한 동선을 거꾸로 복기해 보세요.\n2. 방문하셨던 매장, 대중교통 유실물센터, 경찰청 Lost112 포털에 분실 접수 여부를 확인하세요.\n3. 저희 찾아줘 앱의 [분실물 등록]에 등록해 두시면, 이웃이 습득물을 올릴 때 즉시 매칭 알림을 드려요!`;
  }

  async function handleAiQuestion(q) {
    if (!q || !q.trim()) return;
    appendChatMsg(q, false);
    aiChatInput.value = '';

    const loadingBubble = appendChatMsg('AI 탐정이 수칙을 분석하고 있어요...', true);

    try {
      // 1. API 서버 호출 시도
      const res = await fetch('/api/ask-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.trim() })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '답변 생성에 실패했어요.');
      }
      loadingBubble.textContent = data.answer;

    } catch (err) {
      console.warn('[AI API 호출 불가, 스마트 가이드로 자동 전환]:', err.message);
      
      // 사용자에게 상황 안내와 함께 스마트 가이드 답변을 즉시 제공
      const fallback = getSmartFallbackAnswer(q);
      loadingBubble.textContent = `${fallback}\n\n---\n💡 안내: 실제 OpenRouter 실시간 모델과 연동하려면 터미널에서 'npm run dev'를 실행하고 .env.local에 API 키를 입력해 주세요.`;
    }
  }

  btnAiChatSend?.addEventListener('click', () => handleAiQuestion(aiChatInput.value));
  aiChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAiQuestion(aiChatInput.value);
  });

  document.querySelectorAll('.sug-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      handleAiQuestion(btn.dataset.ask);
    });
  });

  // =========================================================================
  // 7. 내 기록 뷰 렌더링
  // =========================================================================
  const historyItemsCount = document.getElementById('history-items-count');
  const historyRegisteredItems = document.getElementById('history-registered-items');
  const historySearchesChips = document.getElementById('history-searches-chips');
  const btnClearHistorySearches = document.getElementById('btn-clear-history-searches');

  function renderHistoryView() {
    const items = getStoredItems();
    if (historyItemsCount) historyItemsCount.textContent = `총 ${items.length}건`;

    if (historyRegisteredItems) {
      if (items.length === 0) {
        historyRegisteredItems.innerHTML = '<div style="text-align:center; padding:20px; color:#8e9c94;">등록하신 물건이 없어요.</div>';
      } else {
        historyRegisteredItems.innerHTML = items.map(item => `
          <div class="result-card-box">
            <div class="res-card-top">
              <span class="${item.mode === 'lost' ? 'res-tag-lost' : 'res-tag-found'}">
                ${item.mode === 'lost' ? '😢 잃어버렸어요' : '🎁 주웠어요'}
              </span>
              <span style="font-size:0.75rem; color:#8e9c94;">${escapeHtml(item.category)}</span>
            </div>
            <div class="res-card-name">${escapeHtml(item.name)}</div>
            <div class="res-card-loc">📍 ${escapeHtml(item.location || '위치 미기재')} · ${escapeHtml(item.time || '최근')}</div>
            <div class="res-card-desc">${escapeHtml(item.features || '')}</div>
            <button type="button" class="btn-chat-action" data-item-id="${item.id}">
              💬 ${item.mode === 'lost' ? '분실자 채팅창 열기' : '습득자 채팅창 열기'}
            </button>
          </div>
        `).join('');
      }
    }

    if (historySearchesChips) {
      const searches = getRecentSearches();
      if (searches.length === 0) {
        historySearchesChips.innerHTML = '<span style="font-size:0.82rem; color:#8e9c94;">검색 기록이 없어요.</span>';
      } else {
        historySearchesChips.innerHTML = searches.map(s => `
          <button type="button" class="sug-chip" style="cursor:default;">🔍 ${escapeHtml(s.query)}</button>
        `).join('');
      }
    }
  }

  btnClearHistorySearches?.addEventListener('click', () => {
    localStorage.setItem(KEY_SEARCHES, JSON.stringify([]));
    renderHistoryView();
  });

  // 유틸리티
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // =========================================================================
  // 8. [신규 기능] 이웃과 1:1 안심 채팅 시스템
  // =========================================================================
  const KEY_CHATS = 'findit_neighbor_chats';
  const chatRoomsList = document.getElementById('chat-rooms-list');
  const chatItemThumb = document.getElementById('chat-item-thumb');
  const chatItemModeBadge = document.getElementById('chat-item-mode-badge');
  const chatItemName = document.getElementById('chat-item-name');
  const chatItemLoc = document.getElementById('chat-item-loc');
  const neighborChatMessages = document.getElementById('neighbor-chat-messages');
  const neighborChatInput = document.getElementById('neighbor-chat-input');
  const btnNeighborSend = document.getElementById('btn-neighbor-send');
  const chatNavBadge = document.getElementById('chat-nav-badge');

  let activeChatRoomId = null;

  function getStoredChats() {
    const raw = localStorage.getItem(KEY_CHATS);
    if (!raw) {
      // 초기 데모 대화방 2개 생성
      const initialChats = [
        {
          id: 'room_demo_1',
          itemId: 'item_demo_1',
          itemName: '에어팟 프로 2세대 본체',
          itemMode: 'found',
          itemLocation: '강남역 11번 출구 벤치',
          itemImage: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=240&auto=format&fit=crop&q=80',
          otherUserName: '강남역 친절이웃',
          updatedAt: '방금 전',
          messages: [
            { id: 1, sender: 'other', text: '안녕하세요! 에어팟을 주워서 보관하고 있습니다. 혹시 본인 물건이 맞으신가요?', time: '오후 2:10' },
            { id: 2, sender: 'me', text: '네 안녕하세요! 혹시 케이스 뒤쪽에 곰돌이 푸우 스티커가 붙어 있나요?', time: '오후 2:12' },
            { id: 3, sender: 'other', text: '맞아요! 노란색 스티커가 붙어있네요. 역삼역 인근이나 강남역 고객안전실에 맡겨둘까요?', time: '오후 2:13' }
          ]
        },
        {
          id: 'room_demo_2',
          itemId: 'item_demo_2',
          itemName: '갈색 가죽 카드지갑',
          itemMode: 'lost',
          itemLocation: '서초동 스타벅스 인근',
          itemImage: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=240&auto=format&fit=crop&q=80',
          otherUserName: '서초 분실자',
          updatedAt: '10분 전',
          messages: [
            { id: 1, sender: 'other', text: '지갑을 잃어버려서 너무 걱정 중입니다 ㅠㅠ 혹시 보셨나요?', time: '오전 11:30' }
          ]
        }
      ];
      localStorage.setItem(KEY_CHATS, JSON.stringify(initialChats));
      return initialChats;
    }
    return JSON.parse(raw);
  }

  function renderChatRoomsList() {
    if (!chatRoomsList) return;
    const chats = getStoredChats();
    if (chats.length === 0) {
      chatRoomsList.innerHTML = '<div style="text-align:center; padding:30px; font-size:0.85rem; color:#8b95a1;">진행 중인 대화가 없어요.</div>';
      return;
    }

    chatRoomsList.innerHTML = chats.map(room => {
      const lastMsg = room.messages[room.messages.length - 1];
      const isActive = room.id === activeChatRoomId ? 'active' : '';
      return `
        <div class="chat-room-item ${isActive}" data-room-id="${room.id}">
          <img src="${room.itemImage || 'https://via.placeholder.com/60?text=FindIt'}" class="room-thumb" alt="물품">
          <div class="room-info">
            <div class="room-name-row">
              <span class="room-user-name">${escapeHtml(room.otherUserName)}</span>
              <span class="room-time">${room.updatedAt}</span>
            </div>
            <div class="room-last-msg">${lastMsg ? escapeHtml(lastMsg.text) : '대화를 시작하세요'}</div>
          </div>
        </div>
      `;
    }).join('');

    // 기본 첫 번째 방 자동 선택
    if (!activeChatRoomId && chats.length > 0) {
      selectChatRoom(chats[0].id);
    }
  }

  function selectChatRoom(roomId) {
    activeChatRoomId = roomId;
    const chats = getStoredChats();
    const targetRoom = chats.find(r => r.id === roomId);
    if (!targetRoom) return;

    // 상단 물품 바 정보 바인딩
    if (chatItemThumb) chatItemThumb.src = targetRoom.itemImage || 'https://via.placeholder.com/60?text=FindIt';
    if (chatItemName) chatItemName.textContent = targetRoom.itemName;
    if (chatItemLoc) chatItemLoc.textContent = `📍 ${targetRoom.itemLocation}`;
    if (chatItemModeBadge) {
      chatItemModeBadge.className = targetRoom.itemMode === 'lost' ? 'res-tag-lost' : 'res-tag-found';
      chatItemModeBadge.textContent = targetRoom.itemMode === 'lost' ? '분실물' : '습득물';
    }

    // 메시지 렌더링
    renderMessages(targetRoom.messages, targetRoom.otherUserName);

    // 사이드바 목록 활성화 UI 갱신
    document.querySelectorAll('.chat-room-item').forEach(el => {
      if (el.dataset.roomId === roomId) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  function renderMessages(messages, otherName) {
    if (!neighborChatMessages) return;
    const noticeHtml = `<div class="chat-start-notice"><span>안전한 직거래 및 공공 유실물센터/역무실 인계를 권장합니다.</span></div>`;
    const msgsHtml = messages.map(m => `
      <div class="msg-row-neighbor ${m.sender}">
        ${m.sender === 'other' ? `<span class="msg-sender-label">${escapeHtml(otherName)}</span>` : ''}
        <div class="msg-bubble-neighbor">${escapeHtml(m.text)}</div>
        <span class="msg-time-label">${m.time}</span>
      </div>
    `).join('');

    neighborChatMessages.innerHTML = noticeHtml + msgsHtml;
    neighborChatMessages.scrollTop = neighborChatMessages.scrollHeight;
  }

  function sendNeighborMsg(text) {
    if (!text || !text.trim() || !activeChatRoomId) return;
    const chats = getStoredChats();
    const room = chats.find(r => r.id === activeChatRoomId);
    if (!room) return;

    const now = new Date();
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newMsg = {
      id: Date.now(),
      sender: 'me',
      text: text.trim(),
      time: timeStr
    };

    room.messages.push(newMsg);
    room.updatedAt = '방금 전';
    localStorage.setItem(KEY_CHATS, JSON.stringify(chats));

    renderMessages(room.messages, room.otherUserName);
    renderChatRoomsList();
    neighborChatInput.value = '';

    // 상대방(이웃) 자동 응답 시뮬레이션 (1.2초 후)
    setTimeout(() => {
      const autoReplies = [
        '네 확인했습니다! 말씀해 주신 특징이 정확히 일치하네요.',
        '직접 대면 수령도 가능하고, 가까운 역무실이나 경비실에 맡겨둘 수도 있어요.',
        '소중한 물건을 찾으셔서 정말 다행입니다! 안전하게 전달해 드릴게요.',
        '혹시 언제쯤 방문 가능하신가요? 시간 맞춰둘게요.'
      ];
      const replyText = autoReplies[Math.floor(Math.random() * autoReplies.length)];
      
      const otherReply = {
        id: Date.now() + 1,
        sender: 'other',
        text: replyText,
        time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
      };
      room.messages.push(otherReply);
      localStorage.setItem(KEY_CHATS, JSON.stringify(chats));
      renderMessages(room.messages, room.otherUserName);
      renderChatRoomsList();
    }, 1200);
  }

  btnNeighborSend?.addEventListener('click', () => sendNeighborMsg(neighborChatInput.value));
  neighborChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendNeighborMsg(neighborChatInput.value);
  });

  // 상용구 칩 클릭
  document.querySelectorAll('.phrase-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const phrase = btn.dataset.text;
      sendNeighborMsg(phrase);
    });
  });

  // 채팅방 항목 클릭 시 전환
  document.addEventListener('click', (e) => {
    const roomItem = e.target.closest('.chat-room-item');
    if (roomItem) {
      selectChatRoom(roomItem.dataset.roomId);
      return;
    }

    // 카드에서 "이웃과 대화하기 / 채팅창 열기" 버튼 클릭 시
    const chatActionBtn = e.target.closest('.btn-chat-action');
    if (chatActionBtn) {
      const itemId = chatActionBtn.dataset.itemId;
      const items = getStoredItems();
      const targetItem = items.find(i => i.id === itemId);
      if (!targetItem) return;

      const chats = getStoredChats();
      let existingRoom = chats.find(r => r.itemId === itemId);

      if (!existingRoom) {
        existingRoom = {
          id: 'room_' + Date.now(),
          itemId: targetItem.id,
          itemName: targetItem.name,
          itemMode: targetItem.mode,
          itemLocation: targetItem.location || '위치 미기재',
          itemImage: targetItem.imageUrl,
          otherUserName: targetItem.mode === 'lost' ? '분실자 이웃' : '습득자 이웃',
          updatedAt: '방금 전',
          messages: [
            { id: 1, sender: 'other', text: `안녕하세요! 등록하신 [${targetItem.name}] 건으로 대화방이 연결되었습니다.`, time: '방금 전' }
          ]
        };
        chats.unshift(existingRoom);
        localStorage.setItem(KEY_CHATS, JSON.stringify(chats));
      }

      switchView('chat');
      selectChatRoom(existingRoom.id);
    }
  });

  // =========================================================================
  // 9. [신규 기능] 전체 분실물 모아보기 피드 & 상세 모달
  // =========================================================================
  const allItemsGrid = document.getElementById('all-items-grid');
  const allItemsTotalBadge = document.getElementById('all-items-total-badge');
  const itemDetailModal = document.getElementById('item-detail-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnModalChat = document.getElementById('btn-modal-chat');

  let filterMode = 'all'; // 'all' | 'lost' | 'found'
  let filterCat = 'all';
  let modalActiveItem = null;

  function renderAllItemsFeed() {
    if (!allItemsGrid) return;
    const items = getStoredItems();

    // 1. 모드 필터링
    let filtered = items;
    if (filterMode !== 'all') {
      filtered = filtered.filter(i => i.mode === filterMode);
    }

    // 2. 카테고리 필터링
    if (filterCat !== 'all') {
      filtered = filtered.filter(i => i.category && i.category.includes(filterCat));
    }

    if (allItemsTotalBadge) {
      allItemsTotalBadge.textContent = `총 ${filtered.length}건`;
    }

    if (filtered.length === 0) {
      allItemsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:60px 20px; background:#fff; border-radius:16px; border:1px solid #e5e8eb; color:#8b95a1;">해당 조건에 일치하는 등록된 물건이 없어요.</div>';
      return;
    }

    allItemsGrid.innerHTML = filtered.map(item => `
      <div class="all-item-card" data-card-id="${item.id}">
        <div class="card-thumb-wrap">
          <img src="${item.imageUrl || 'https://via.placeholder.com/300x200?text=FindIt'}" alt="${escapeHtml(item.name)}">
          <div class="card-badge-float">
            <span class="${item.mode === 'lost' ? 'res-tag-lost' : 'res-tag-found'}">
              ${item.mode === 'lost' ? '😢 잃어버렸어요' : '🎁 주웠어요'}
            </span>
            <span class="category-chip" style="font-size:0.72rem; padding:2px 8px;">${escapeHtml(item.category || '기타')}</span>
          </div>
        </div>
        <div class="card-body-content">
          <div class="card-title-text">${escapeHtml(item.name)}</div>
          <div class="card-location-meta">📍 ${escapeHtml(item.location || '위치 미기재')} · ${escapeHtml(item.time || '최근')}</div>
          <div class="card-features-snippet">${escapeHtml(item.features || item.summary || '')}</div>
          <div class="card-action-bar">
            <button type="button" class="btn-card-chat" data-item-id="${item.id}">
              💬 ${item.mode === 'lost' ? '분실자와 대화하기' : '습득자와 대화하기'}
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  // 모드 필터 탭 클릭
  document.querySelectorAll('.f-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.f-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterMode = btn.dataset.mode;
      renderAllItemsFeed();
    });
  });

  // 카테고리 칩 필터 클릭
  document.querySelectorAll('.f-cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.f-cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterCat = btn.dataset.cat;
      renderAllItemsFeed();
    });
  });

  // 카드 클릭 시 상세 모달 열기
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.all-item-card');
    // 채팅 버튼 누를 때는 모달 열기 방지
    if (card && !e.target.closest('.btn-card-chat')) {
      const itemId = card.dataset.cardId;
      const items = getStoredItems();
      const item = items.find(i => i.id === itemId);
      if (item) openDetailModal(item);
    }
  });

  function openDetailModal(item) {
    modalActiveItem = item;
    document.getElementById('modal-item-title').textContent = `${item.name} 상세 정보`;
    document.getElementById('modal-item-image').src = item.imageUrl || 'https://via.placeholder.com/400x240?text=FindIt';
    document.getElementById('modal-item-name').textContent = item.name;
    document.getElementById('modal-item-location').textContent = item.location || '위치 미기재';
    document.getElementById('modal-item-time').textContent = item.time || '최근';
    document.getElementById('modal-item-color').textContent = item.color || '확인 필요';
    document.getElementById('modal-item-features').textContent = item.features || item.summary || '특이사항 없음';

    const modeBadge = document.getElementById('modal-mode-badge');
    modeBadge.className = item.mode === 'lost' ? 'res-tag-lost' : 'res-tag-found';
    modeBadge.textContent = item.mode === 'lost' ? '😢 분실물' : '🎁 습득물';
    document.getElementById('modal-category-badge').textContent = item.category || '기타';

    itemDetailModal.classList.remove('hidden');
  }

  btnCloseModal?.addEventListener('click', () => {
    itemDetailModal.classList.add('hidden');
  });

  itemDetailModal?.addEventListener('click', (e) => {
    if (e.target === itemDetailModal) {
      itemDetailModal.classList.add('hidden');
    }
  });

  btnModalChat?.addEventListener('click', () => {
    if (!modalActiveItem) return;
    itemDetailModal.classList.add('hidden');

    // 1:1 대화방 개설 및 이동
    const chats = getStoredChats();
    let existingRoom = chats.find(r => r.itemId === modalActiveItem.id);

    if (!existingRoom) {
      existingRoom = {
        id: 'room_' + Date.now(),
        itemId: modalActiveItem.id,
        itemName: modalActiveItem.name,
        itemMode: modalActiveItem.mode,
        itemLocation: modalActiveItem.location || '위치 미기재',
        itemImage: modalActiveItem.imageUrl,
        otherUserName: modalActiveItem.mode === 'lost' ? '분실자 이웃' : '습득자 이웃',
        updatedAt: '방금 전',
        messages: [
          { id: 1, sender: 'other', text: `안녕하세요! 등록하신 [${modalActiveItem.name}] 상세 정보를 보고 연락드렸습니다.`, time: '방금 전' }
        ]
      };
      chats.unshift(existingRoom);
      localStorage.setItem(KEY_CHATS, JSON.stringify(chats));
    }

    switchView('chat');
    selectChatRoom(existingRoom.id);
  });

  // =========================================================================
  // 10. [신규 기능] 보관 장소 지도 & 찾아가기 길안내 시스템 (Leaflet.js)
  // =========================================================================
  const mapItemSelect = document.getElementById('map-item-select');
  const btnGetMyLocation = document.getElementById('btn-get-my-location');
  const routeItemTitle = document.getElementById('route-item-title');
  const routeDistanceText = document.getElementById('route-distance-text');
  const routeDurationText = document.getElementById('route-duration-text');
  const routeStartLoc = document.getElementById('route-start-loc');
  const routeEndLoc = document.getElementById('route-end-loc');
  const linkKakaoMap = document.getElementById('link-kakao-map');
  const linkNaverMap = document.getElementById('link-naver-map');
  const btnMapChat = document.getElementById('btn-map-chat');
  const btnModalMap = document.getElementById('btn-modal-map');

  let leafletMap = null;
  let myLocationMarker = null;
  let targetLocationMarker = null;
  let routeLine = null;

  // 기본 내 위치: 서울 강남역 인근 (37.4979, 127.0276)
  let userCoords = { lat: 37.4979, lng: 127.0276, name: '내 현재 위치 (강남역 인근)' };

  // 각 물품별 가상 보관처 좌표 매핑 사전 (실제 지도 연동용)
  const itemCoordinates = {
    'item_demo_1': { lat: 37.4983, lng: 127.0284, placeName: '강남역 11번 출구 고객안전실' },
    'item_demo_2': { lat: 37.4925, lng: 127.0240, placeName: '서초동 스타벅스 인근 분실물센터' }
  };

  function setupMapView(preferredItemId = null) {
    initLeafletMap();
    renderMapItemSelect(preferredItemId);
    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 200);
  }

  function initLeafletMap() {
    if (leafletMap) return;

    const mapEl = document.getElementById('lost-found-map');
    if (!mapEl || typeof L === 'undefined') return;

    // 1. 지도 인스턴스 생성
    leafletMap = L.map('lost-found-map').setView([userCoords.lat, userCoords.lng], 15);

    // 2. OpenStreetMap 타일 레이어 추가
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);
  }

  function renderMapItemSelect(preferredItemId = null) {
    if (!mapItemSelect) return;
    const items = getStoredItems();

    mapItemSelect.innerHTML = items.map(item => `
      <option value="${item.id}" ${preferredItemId === item.id ? 'selected' : ''}>
        ${item.mode === 'lost' ? '[분실] ' : '[습득] '} ${escapeHtml(item.name)} (${escapeHtml(item.location || '위치 미기재')})
      </option>
    `).join('');

    const targetId = preferredItemId || mapItemSelect.value || (items[0] && items[0].id);
    if (targetId) {
      focusMapOnItem(targetId);
    }
  }

  function focusMapOnItem(itemId) {
    const items = getStoredItems();
    const item = items.find(i => i.id === itemId);
    if (!item || !leafletMap) return;

    // 보관 장소 좌표 가져오기 (없으면 강남역 인근으로 지터 배치)
    let coord = itemCoordinates[itemId];
    if (!coord) {
      coord = {
        lat: 37.4970 + (Math.random() - 0.5) * 0.008,
        lng: 127.0270 + (Math.random() - 0.5) * 0.008,
        placeName: item.location || '보관 장소'
      };
      itemCoordinates[itemId] = coord;
    }

    // 1. 내 위치 마커 업데이트
    if (myLocationMarker) leafletMap.removeLayer(myLocationMarker);
    const myIcon = L.divIcon({
      className: 'custom-map-icon',
      html: '<div style="background:#3182f6; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 10px rgba(49,130,246,0.8);"></div>',
      iconSize: [22, 22]
    });
    myLocationMarker = L.marker([userCoords.lat, userCoords.lng], { icon: myIcon })
      .addTo(leafletMap)
      .bindPopup(`<b>내 위치</b><br>${userCoords.name}`)
      .openPopup();

    // 2. 보관처 마커 업데이트
    if (targetLocationMarker) leafletMap.removeLayer(targetLocationMarker);
    const targetIcon = L.divIcon({
      className: 'custom-map-icon',
      html: '<div style="background:#e45600; width:20px; height:20px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 12px rgba(228,86,0,0.8); display:flex; align-items:center; justify-content:center; color:#fff; font-size:10px; font-weight:bold;">📍</div>',
      iconSize: [26, 26]
    });
    targetLocationMarker = L.marker([coord.lat, coord.lng], { icon: targetIcon })
      .addTo(leafletMap)
      .bindPopup(`<b>${escapeHtml(item.name)} 보관처</b><br>${escapeHtml(coord.placeName)}`);

    // 3. 경로 연결선(대시 폴리라인) 그리기
    if (routeLine) leafletMap.removeLayer(routeLine);
    routeLine = L.polyline([
      [userCoords.lat, userCoords.lng],
      [coord.lat, coord.lng]
    ], {
      color: '#3182f6',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.8
    }).addTo(leafletMap);

    // 두 점이 모두 보이도록 지도 화면 범위 맞추기
    const group = L.featureGroup([myLocationMarker, targetLocationMarker]);
    leafletMap.fitBounds(group.getBounds().pad(0.2));

    // 4. 거리 및 도보 시간 계산
    const distMeter = Math.round(calculateDistance(userCoords.lat, userCoords.lng, coord.lat, coord.lng));
    const distText = distMeter >= 1000 ? `${(distMeter / 1000).toFixed(1)}km` : `${distMeter}m`;
    const walkMinutes = Math.max(1, Math.round(distMeter / 67)); // 분당 67m 도보 속도

    // 5. 카드 정보 업데이트
    if (routeItemTitle) routeItemTitle.textContent = `${item.name} 보관처로 이동`;
    if (routeDistanceText) routeDistanceText.textContent = `약 ${distText}`;
    if (routeDurationText) routeDurationText.textContent = `도보 약 ${walkMinutes}분`;
    if (routeStartLoc) routeStartLoc.textContent = userCoords.name;
    if (routeEndLoc) routeEndLoc.textContent = `${coord.placeName}`;

    // 6. 카카오맵 및 네이버 지도 길찾기 링크 바인딩
    if (linkKakaoMap) {
      linkKakaoMap.href = `https://map.kakao.com/link/to/${encodeURIComponent(item.name + ' 보관처')},${coord.lat},${coord.lng}`;
    }
    if (linkNaverMap) {
      linkNaverMap.href = `https://map.naver.com/v5/directions/-/,-,/${coord.lng},${coord.lat},${encodeURIComponent(item.name + ' 보관처')}/walk`;
    }

    if (btnMapChat) {
      btnMapChat.onclick = () => {
        openChatForItemId(item.id);
      };
    }
  }

  // Haversine 거리 계산 함수 (m 단위)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // 지구 반경 (m)
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // 드롭다운 변경 시 해당 물품으로 지도 포커스
  mapItemSelect?.addEventListener('change', () => {
    focusMapOnItem(mapItemSelect.value);
  });

  // GPS 내 위치 찾기
  btnGetMyLocation?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치 정보(GPS)를 지원하지 않아요.');
      return;
    }
    btnGetMyLocation.textContent = '🛰️ 위치 찾는 중...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: '내 실제 현재 위치 (GPS)'
        };
        btnGetMyLocation.textContent = '🎯 내 위치 찾기 (GPS)';
        alert('내 위치가 성공적으로 갱신되었습니다!');
        if (mapItemSelect) focusMapOnItem(mapItemSelect.value);
      },
      (err) => {
        btnGetMyLocation.textContent = '🎯 내 위치 찾기 (GPS)';
        alert(`위치 정보를 가져오지 못했어요 (${err.message}). 기본 강남역 인근 좌표로 설정됩니다.`);
      },
      { timeout: 8000 }
    );
  });

  // 모달 내 "지도에서 찾아가기" 버튼 클릭 시
  btnModalMap?.addEventListener('click', () => {
    if (!modalActiveItem) return;
    itemDetailModal.classList.add('hidden');
    switchView('map');
    setupMapView(modalActiveItem.id);
  });

  function openChatForItemId(itemId) {
    const items = getStoredItems();
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const chats = getStoredChats();
    let existingRoom = chats.find(r => r.itemId === itemId);
    if (!existingRoom) {
      existingRoom = {
        id: 'room_' + Date.now(),
        itemId: item.id,
        itemName: item.name,
        itemMode: item.mode,
        itemLocation: item.location || '위치 미기재',
        itemImage: item.imageUrl,
        otherUserName: item.mode === 'lost' ? '분실자 이웃' : '습득자 이웃',
        updatedAt: '방금 전',
        messages: [
          { id: 1, sender: 'other', text: `안녕하세요! [${item.name}] 보관처를 찾아가기 전 대화방이 연결되었습니다.`, time: '방금 전' }
        ]
      };
      chats.unshift(existingRoom);
      localStorage.setItem(KEY_CHATS, JSON.stringify(chats));
    }

    switchView('chat');
    selectChatRoom(existingRoom.id);
  }

  // 초기 로드 실행
  renderRecentSearches();
  updateMatchCount();
  updateNotiUI();
  renderChatRoomsList();
  renderAllItemsFeed();
});



