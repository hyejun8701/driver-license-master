import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAUeLJOUQODemC29esT2E3XiiwCqwaD3a0",
  authDomain: "driver-license-master.firebaseapp.com",
  databaseURL: "https://driver-license-master-default-rtdb.firebaseio.com",
  projectId: "driver-license-master",
  storageBucket: "driver-license-master.appspot.com",
  messagingSenderId: "985665335910",
  appId: "1:985665335910:web:11dac52cabf8c0ed30f3a7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firebaseDb = getDatabase(app);
const provider = new GoogleAuthProvider();

let currentUser = null;

// ====================================================
// 전역 변수
// ====================================================
let db = []; 
let activeDb = []; 
let examDb = []; 

let memorizeIdx = 0;
let examIdx = 0;
let currentMode = 'memorize'; 
let isExamStarted = false;
let isAnimating = false;
let hideMemorized = true;

let memorizedSet = new Set();
let wrongSet = new Set();
let bookmarkSet = new Set();
let streakMap = {};

let userAnswers = {}; 
let timerInterval = null;
let timeLeft = 2400; 

let dragStartX = 0;
let dragEndX = 0;
let isMouseDown = false;

const cardBox = document.getElementById('cardBox');

// ====================================================
// Firebase 인증 & 화면 전환
// ====================================================

window.handleGoogleLogin = function() {
    signInWithPopup(auth, provider)
        .then(() => {
            showToast("🎉 로그인 성공!");
        })
        .catch((error) => {
            console.error("로그인 오류:", error);
            alert("로그인에 실패했습니다.");
        });
};

window.handleLogout = function() {
    signOut(auth).then(() => {
        showToast("로그아웃 되었습니다.");
    });
};

// 인증 상태 감지 및 UI (화면) 전환
onAuthStateChanged(auth, (user) => {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const userInfo = document.getElementById('userInfo');

    if (user) {
        currentUser = user;
        
        // 로그인 화면 숨기고 메인 컨텐츠 표시
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        if (userInfo) userInfo.innerText = `👤 ${user.displayName || '사용자'}님`;

        loadUserDataFromCloud(user.uid);
    } else {
        currentUser = null;

        // 로그아웃 시 전면 로그인 화면 표시 (flex로 설정)
        if (loginScreen) loginScreen.style.display = 'flex';
        if (mainApp) mainApp.style.display = 'none';
        if (userInfo) userInfo.innerText = '';
    }
});

function saveUserData() {
    if (!currentUser) return;

    const dataToSave = {
        memorized_questions: Array.from(memorizedSet),
        wrong_questions: Array.from(wrongSet),
        bookmarked_questions: Array.from(bookmarkSet),
        streak_map: streakMap,
        updatedAt: new Date().toISOString()
    };

    localStorage.setItem('memorized_questions', JSON.stringify(dataToSave.memorized_questions));
    localStorage.setItem('wrong_questions', JSON.stringify(dataToSave.wrong_questions));
    localStorage.setItem('bookmarked_questions', JSON.stringify(dataToSave.bookmarked_questions));
    localStorage.setItem('streak_map', JSON.stringify(dataToSave.streak_map));

    const userRef = ref(firebaseDb, 'users/' + currentUser.uid);
    set(userRef, dataToSave).catch(err => console.error("Firebase 저장 오류:", err));
}

function loadUserDataFromCloud(uid) {
    const userRef = ref(firebaseDb, 'users/' + uid);
    
    // [핵심] 기기에 이미 남아있던 로컬 데이터 먼저 가져오기
    const localMemorized = JSON.parse(localStorage.getItem('memorized_questions') || '[]');
    const localWrong = JSON.parse(localStorage.getItem('wrong_questions') || '[]');
    const localBookmark = JSON.parse(localStorage.getItem('bookmarked_questions') || '[]');
    const localStreak = JSON.parse(localStorage.getItem('streak_map') || '{}');

    get(userRef).then((snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            
            // [핵심] 클라우드 데이터와 로컬 데이터를 합치기 (중복 제거)
            memorizedSet = new Set([...localMemorized, ...(data.memorized_questions || [])]);
            wrongSet = new Set([...localWrong, ...(data.wrong_questions || [])]);
            bookmarkSet = new Set([...localBookmark, ...(data.bookmarked_questions || [])]);
            
            // streakMap 합치기
            streakMap = { ...localStreak, ...(data.streak_map || {}) };

        } else {
            // 서버에 데이터가 아예 없다면 로컬 데이터를 그대로 사용
            memorizedSet = new Set(localMemorized);
            wrongSet = new Set(localWrong);
            bookmarkSet = new Set(localBookmark);
            streakMap = localStreak;
        }
        
        // 합쳐진 최종 데이터를 로컬과 클라우드에 다시 동기화 저장
        saveUserData();

        // UI 렌더링 진행
        updateActiveDb();
        updateExamFilterCounts();

        const loadingEl = document.getElementById('loading');
        const quizContentEl = document.getElementById('quizContent');
        if (loadingEl) loadingEl.style.display = 'none';
        
        if (currentMode === 'memorize' && quizContentEl) {
            quizContentEl.style.display = 'flex';
            loadQ();
        }
    }).catch(err => {
        console.error("Firebase 불러오기 오류:", err);
        // 에러 발생 시 안전하게 로컬 데이터로 복구
        memorizedSet = new Set(localMemorized);
        wrongSet = new Set(localWrong);
        bookmarkSet = new Set(localBookmark);
        streakMap = localStreak;

        updateActiveDb();
        
        const loadingEl = document.getElementById('loading');
        const quizContentEl = document.getElementById('quizContent');
        if (loadingEl) loadingEl.style.display = 'none';
        if (currentMode === 'memorize' && quizContentEl) {
            quizContentEl.style.display = 'flex';
            loadQ();
        }
    });
}

// ====================================================
// 주요 기능 및 이벤트 바인딩
// ====================================================

const fontSizes = ['font-small', 'font-medium', 'font-large', 'font-xlarge'];
let currentFontIdx = 1; // 기본 medium

window.adjustFontSize = function(direction) {
    currentFontIdx += direction;
    
    if (currentFontIdx < 0) currentFontIdx = 0;
    if (currentFontIdx >= fontSizes.length) currentFontIdx = fontSizes.length - 1;

    applyFontSize();
};

function applyFontSize() {
    const cardBoxEl = document.getElementById('cardBox');
    if (!cardBoxEl) return;
    
    // 카드 영역에서 기존 폰트 클래스 제거 후 새로운 크기 적용
    fontSizes.forEach(cls => cardBoxEl.classList.remove(cls));
    cardBoxEl.classList.add(fontSizes[currentFontIdx]);

    localStorage.setItem('font_size_idx', currentFontIdx);
}

window.addEventListener('DOMContentLoaded', () => {
    const savedFontIdx = localStorage.getItem('font_size_idx');
    if (savedFontIdx !== null) {
        currentFontIdx = parseInt(savedFontIdx);
        applyFontSize();
    }

    loadJsonData();

    ['qInput', 'rangeStart', 'rangeEnd'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            let originalVal = '';

            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (id === 'qInput') window.jumpToQ();
                }
            });

            el.addEventListener('focus', () => {
                originalVal = el.value; 
                el.value = ''; 
            });

            el.addEventListener('blur', () => {
                if (el.value.trim() === '') {
                    el.value = originalVal;
                }
                if (id === 'rangeStart' || id === 'rangeEnd') {
                    updateExamFilterCounts();
                }
            });

            if (id === 'rangeStart' || id === 'rangeEnd') {
                el.addEventListener('input', updateExamFilterCounts);
            }
        }
    });
});

function loadJsonData() {
    fetch('./questions_full.json')
        .then(response => {
            if (!response.ok) throw new Error('네트워크 응답 오류');
            return response.json();
        })
        .then(data => {
            initQuiz(data);
        })
        .catch(error => {
            console.error('JSON 파일 로드 실패:', error);
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.innerHTML = `
                    <div style="font-weight: bold; color: #ef4444; line-height: 1.4; font-size: 0.85rem;">
                        ⚠️ questions_full.json 데이터를 불러오지 못했습니다.
                    </div>
                `;
            }
        });
}

cardBox.addEventListener('touchstart', e => {
    dragStartX = e.changedTouches[0].screenX;
}, false);

cardBox.addEventListener('touchend', e => {
    dragEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, false);

cardBox.addEventListener('mousedown', e => {
    isMouseDown = true;
    dragStartX = e.screenX;
});

cardBox.addEventListener('mouseup', e => {
    if (!isMouseDown) return;
    isMouseDown = false;
    dragEndX = e.screenX;
    handleSwipe();
});

cardBox.addEventListener('mouseleave', e => {
    if (isMouseDown) {
        isMouseDown = false;
        dragEndX = e.screenX;
        handleSwipe();
    }
});

document.addEventListener('keydown', e => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) return;

    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        swipeTo('prev');
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        swipeTo('next');
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cardBox.scrollTop -= 20; 
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        cardBox.scrollTop += 20; 
    }
});

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('toastMsg');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}
window.showToast = showToast;

window.showSwipeGuide = function(force = false) {
    if (force || !localStorage.getItem('swipe_guide_shown')) {
        showToast('👈 좌우로 스와이프 또는 방향키(←/→)로 넘기세요');
        localStorage.setItem('swipe_guide_shown', 'true');
    }
};

function handleSwipe() {
    const isResultVisible = document.getElementById('resultContent').style.display !== 'none';
    if (!db.length || isAnimating || isResultVisible) return;
    if (currentMode === 'exam' && !isExamStarted) return;

    const threshold = 50; 
    const diff = dragEndX - dragStartX;

    if (Math.abs(diff) > threshold) {
        if (diff < 0) swipeTo('next');
        else swipeTo('prev');
    }
}

function swipeTo(dir) {
    const list = getCurList();
    let curIdx = getCurIdx();

    if (dir === 'next') {
        if (curIdx >= list.length - 1) {
            if (currentMode === 'exam') {
                window.submitExam();
                return;
            } else {
                // 암기장 모드 끝 -> 처음으로 순환
                //showToast("🔄 첫 번째 문제로 돌아갑니다.");
                curIdx = 0;
            }
        } else {
            curIdx++;
        }
    } else if (dir === 'prev') {
        if (curIdx <= 0) {
            if (currentMode === 'memorize') {
                // 암기장 모드 처음 -> 마지막으로 순환
                //showToast("🔄 마지막 문제로 이동합니다.");
                curIdx = list.length - 1;
            } else {
                return;
            }
        } else {
            curIdx--;
        }
    }

    isAnimating = true;
    setCurIdx(curIdx);

    const outClass = dir === 'next' ? 'slide-out-left' : 'slide-out-right';
    const inClass = dir === 'next' ? 'slide-in-from-right' : 'slide-in-from-left';

    cardBox.classList.add(outClass);

    setTimeout(() => {
        loadQ();

        cardBox.style.transition = 'none';
        cardBox.classList.remove(outClass);
        cardBox.classList.add(inClass);

        cardBox.offsetHeight; 

        cardBox.style.transition = 'transform 0.25s ease-in-out, opacity 0.25s ease-in-out';
        cardBox.classList.remove(inClass);

        setTimeout(() => { isAnimating = false; }, 250);
    }, 200);
}

function initQuiz(data) {
    db = data.map((item, idx) => ({ ...item, _id: item.id || idx + 1 }));

    if (db.length) {
        document.getElementById('rangeStart').value = 1;
        document.getElementById('rangeEnd').value = db.length;
    }

    updateActiveDb();
    updateExamFilterCounts();
    
    // [수정] 여기서는 곧바로 loadQ()를 부르지 않고, 
    // 파이어베이스 데이터 로딩(loadUserDataFromCloud)이 끝난 후에 그리도록 유도합니다.
}

function updateActiveDb() {
    if (hideMemorized) {
        activeDb = db.filter(item => !memorizedSet.has(item._id));
    } else {
        activeDb = [...db];
    }

    // [수정] 강제로 첫 문제(memorizeIdx = 0)로 튕기게 만들던 이전 로직을 제거하고,
    // 현재 보고 있던 인덱스가 줄어든 activeDb 범위를 넘어가지 않도록만 안전하게 보정합니다.
    if (memorizeIdx >= activeDb.length) {
        memorizeIdx = Math.max(0, activeDb.length - 1);
    }
}

function updateExamFilterCounts() {
    if (!db.length) return;

    const startInput = parseInt(document.getElementById('rangeStart').value) || 1;
    const endInput = parseInt(document.getElementById('rangeEnd').value) || db.length;

    const validStart = Math.max(1, Math.min(startInput, db.length));
    const validEnd = Math.max(validStart, Math.min(endInput, db.length));

    const rangePool = db.slice(validStart - 1, validEnd);

    const totalCount = rangePool.length;
    const memorizedCount = rangePool.filter(item => memorizedSet.has(item._id)).length;
    const unmemorizedCount = totalCount - memorizedCount;
    const wrongCount = rangePool.filter(item => wrongSet.has(item._id)).length;
    const bookmarkCount = rangePool.filter(item => bookmarkSet.has(item._id)).length; // [추가]

    const selectEl = document.getElementById('examFilterSelect');
    if (selectEl) {
        selectEl.options[0].text = `전체 문제 (${totalCount}개)`;
        selectEl.options[1].text = `미완료 문제만 (${unmemorizedCount}개)`;
        selectEl.options[2].text = `외운 문제만 (${memorizedCount}개)`;
        selectEl.options[3].text = `틀린 문제만 (${wrongCount}개)`;
        selectEl.options[4].text = `북마크 문제만 (${bookmarkCount}개)`; // [추가]
    }
}

window.toggleHideMemorized = function() {
    hideMemorized = document.getElementById('hideMemorizedCheck').checked;
    updateActiveDb(); // 내부에서 자동으로 올바른 인덱스를 계산함
    loadQ();          // 1번을 거치지 않고 곧바로 알맞은 문제부터 렌더링
};

window.toggleItemMemorized = function(isChecked) {
    const list = getCurList();
    if (!list.length) return;

    const currentItem = list[getCurIdx()];
    if (!currentItem) return;

    if (isChecked) {
        memorizedSet.add(currentItem._id);
        streakMap[currentItem._id] = 0; 
    } else {
        memorizedSet.delete(currentItem._id);
        streakMap[currentItem._id] = 0;
    }

    saveUserData();
    updateExamFilterCounts();

    if (currentMode === 'memorize' && hideMemorized && isChecked) {
        updateActiveDb();
        // [수정] 첫 번호로 튀는 대신, 현재 인덱스가 리스트 범위를 벗어나지 않도록 안전하게 유지하거나 다음 문제로 연결
        if (memorizeIdx >= activeDb.length) {
            memorizeIdx = Math.max(0, activeDb.length - 1);
        }
        loadQ();
    }
};

window.toggleItemBookmark = function(isChecked) {
    const list = getCurList();
    if (!list.length) return;

    const currentItem = list[getCurIdx()];
    if (!currentItem) return;

    if (isChecked) {
        bookmarkSet.add(currentItem._id);
    } else {
        bookmarkSet.delete(currentItem._id);
    }

    saveUserData();
    updateExamFilterCounts();
};

window.switchMode = function(mode) {
    if (currentMode === 'exam' && isExamStarted && mode === 'memorize') {
        const confirmLeave = confirm("⚠️ 진행 중이던 모의고사가 중단되고 초기화됩니다.\n정말 암기장으로 이동하시겠습니까?");
        if (!confirmLeave) return; 
    }

    currentMode = mode;
    document.getElementById('tabMemorize').classList.toggle('active', mode === 'memorize');
    document.getElementById('tabExam').classList.toggle('active', mode === 'exam');

    const navLeft = document.getElementById('navLeft');
    const examStartBox = document.getElementById('examStartBox');
    const timerBox = document.getElementById('timerBox');
    const btnGroup = document.getElementById('btnGroup');
    const cardBoxEl = document.getElementById('cardBox');
    const examBeforeStart = document.getElementById('examBeforeStart');
    const totalIdxEl = document.getElementById('totalIdx');

    if (mode === 'memorize') {
        isExamStarted = false;
        clearInterval(timerInterval);
        userAnswers = {};

        navLeft.style.display = 'flex';
        examStartBox.style.display = 'none';
        timerBox.style.display = 'none';
        btnGroup.style.display = 'none';
        examBeforeStart.style.display = 'none';
        cardBoxEl.style.display = 'flex';
        totalIdxEl.style.display = 'inline';
        document.getElementById('resultContent').style.display = 'none';

        if (db.length) {
            document.getElementById('quizContent').style.display = 'flex';
            document.getElementById('qInput').max = db.length;
            updateActiveDb();
            loadQ();
        }
    } else {
        navLeft.style.display = 'none';
        totalIdxEl.style.display = 'none'; 
        updateExamFilterCounts();
        window.resetExamSetup();
    }
};

function getCurIdx() {
    return currentMode === 'memorize' ? memorizeIdx : examIdx;
}

function setCurIdx(val) {
    if (currentMode === 'memorize') memorizeIdx = val;
    else examIdx = val;
}

function getCurList() {
    return currentMode === 'memorize' ? activeDb : examDb;
}

function highlightKeywords(text) {
    if (!text) return "";
    let html = text;

    const keywords = [
        '2가지', '두 가지', '두가지', '3가지', 
        '틀린 것은', '틀린것은', 
        '가장 적절하지 않은', '적절하지 않은', '적절하지않은',
        '아닌 것은', '아닌것은', 
        '올바르지 않은', '올바르지않은',
        '바르지 않은', '바르지않은',
        '불가능한', '가장 큰 이유', '과태료', '벌점', '우선순위', '안전거리', '옳지 않은', '옳지않은'
    ];

    keywords.forEach(kw => {
        const reg = new RegExp(kw, 'g');
        html = html.replace(reg, `<span class="kw-highlight">${kw}</span>`);
    });

    return html;
}

function loadQ() {
    const list = getCurList();
    
    if (!list || !list.length) {
        if (currentMode === 'memorize' && hideMemorized) {
            document.getElementById('qText').innerHTML = "🎉 모든 문제를 완료(외움) 처리하셨습니다!";
            document.getElementById('qImgContainer').style.display = 'none';
            document.getElementById('memOptList').style.display = 'none';
            document.getElementById('totalIdx').innerText = '0 / 0';
            document.getElementById('qHeader').style.display = 'none';
            return;
        }
        return;
    }

    document.getElementById('qHeader').style.display = 'flex';

    const curIdx = getCurIdx();
    const item = list[curIdx];

    document.getElementById('qCategory').innerText = item.category || '문제';
    document.getElementById('itemMemorizedCheck').checked = memorizedSet.has(item._id);
    document.getElementById('itemBookmarkCheck').checked = bookmarkSet.has(item._id);
    document.getElementById('qText').innerHTML = highlightKeywords(item.question);

    const imgUrl = item.image_url || item.image || item.img || null;
    const imgDescText = item.image_description || item.img_desc || item.description || null;
    
    const qImgContainer = document.getElementById('qImgContainer');
    const qImageEl = document.getElementById('qImage');
    const qImageDescEl = document.getElementById('qImageDesc');

    if (imgUrl || imgDescText) {
        qImgContainer.style.display = 'flex';

        if (imgUrl) {
            qImageEl.src = imgUrl;
            qImageEl.style.display = 'block';
        } else {
            qImageEl.src = '';
            qImageEl.style.display = 'none';
        }

        if (imgDescText) {
            let formattedDesc = imgDescText.replace(/■/g, '\n■').trim();
            if (formattedDesc.startsWith('\n')) {
                formattedDesc = formattedDesc.substring(1);
            }

            qImageDescEl.innerText = formattedDesc;
            qImageDescEl.style.display = 'block';
        } else {
            qImageDescEl.innerText = '';
            qImageDescEl.style.display = 'none';
        }
    } else {
        qImgContainer.style.display = 'none';
    }

    document.getElementById('qInput').value = item._id; 
    document.getElementById('totalIdx').innerText = `${curIdx + 1} / ${list.length}`;
    document.getElementById('cardBox').scrollTop = 0;

    const optList = document.getElementById('optList');
    const memOptList = document.getElementById('memOptList');
    let formattedOptions = item.options || [];

    if (currentMode === 'memorize') {
        optList.style.display = 'none';
        memOptList.style.display = 'flex';
        memOptList.innerHTML = '';

        formattedOptions.forEach((optText, index) => {
            const optNum = index + 1;
            const optDiv = document.createElement('div');
            const isCorrect = item.answers.includes(optNum);
            
            optDiv.className = `mem-opt-item ${isCorrect ? 'is-answer' : ''}`;
            optDiv.innerText = optText;
            memOptList.appendChild(optDiv);
        });

    } else {
        memOptList.style.display = 'none';
        optList.style.display = 'flex';
        optList.innerHTML = '';

        const selectedArr = userAnswers[curIdx] || [];
        const requiredCount = item.answers.length;
        const isDone = selectedArr.length >= requiredCount;

        formattedOptions.forEach((optText, index) => {
            const optNum = index + 1;
            const btn = document.createElement('button');
            btn.className = 'opt-btn';
            btn.innerText = optText;

            if (selectedArr.includes(optNum)) {
                if (item.answers.includes(optNum)) {
                    btn.classList.add('correct');
                } else {
                    btn.classList.add('wrong');
                }
            }

            if (isDone) {
                btn.disabled = true;
                if (item.answers.includes(optNum)) {
                    btn.classList.add('correct');
                }
            } else {
                if (selectedArr.includes(optNum)) {
                    btn.disabled = true;
                } else {
                    btn.onclick = () => selectOption(optNum);
                }
            }

            optList.appendChild(btn);
        });
    }
}

function selectOption(selectedNum) {
    const curIdx = getCurIdx();
    if (!userAnswers[curIdx]) userAnswers[curIdx] = [];
    if (!userAnswers[curIdx].includes(selectedNum)) userAnswers[curIdx].push(selectedNum);
    loadQ();
}

window.jumpToQ = function() {
    const targetId = parseInt(document.getElementById('qInput').value);
    const list = getCurList();

    const foundIdx = list.findIndex(item => item._id === targetId);

    if (foundIdx !== -1) {
        setCurIdx(foundIdx);
        loadQ();
        document.getElementById('qInput').blur();
    } else {
        if (hideMemorized && memorizedSet.has(targetId)) {
            alert("해당 문제는 '외운 문제'에 포함되어 있어 제외 상태입니다. 스위치를 꺼주세요.");
        } else {
            alert(`1부터 ${db.length} 사이의 올바른 문제 번호를 입력해주세요.`);
        }
    }
};

window.startNewExam = function() {
    if (!db.length) return;

    const filterType = document.getElementById('examFilterSelect').value;
    const startInput = parseInt(document.getElementById('rangeStart').value);
    const endInput = parseInt(document.getElementById('rangeEnd').value);

    if (isNaN(startInput) || isNaN(endInput) || startInput < 1 || endInput > db.length || startInput > endInput) {
        alert(`올바른 범위를 입력해주세요. (1 ~ ${db.length} 사이)`);
        return;
    }

    let pool = db.slice(startInput - 1, endInput);

    if (filterType === 'memorized') {
        pool = pool.filter(item => memorizedSet.has(item._id));
    } else if (filterType === 'unmemorized') {
        pool = pool.filter(item => !memorizedSet.has(item._id));
    } else if (filterType === 'bookmarked') {
        pool = pool.filter(item => bookmarkSet.has(item._id));
    } else if (filterType === 'wrong') {
        pool = pool.filter(item => wrongSet.has(item._id));
    }

    const selectedCount = parseInt(document.getElementById('examCountSelect').value || 40);

    if (pool.length < selectedCount) {
        if (filterType === 'memorized') {
            alert(`선택한 범위 내 '외운 문제'가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)`);
        } else if (filterType === 'bookmarked') {
            alert(`선택한 범위 내 '북마크된 문제'가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)`);
        } else if (filterType === 'wrong') {
            alert(`선택한 범위 내 '틀린 문제'가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)\n모의고사를 더 진행하시면 틀린 문제가 오답노트에 자동 기록됩니다!`);
        } else {
            alert(`선택한 조건의 문제 수가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)`);
        }
        return;
    }

    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    examDb = shuffled.slice(0, selectedCount);

    examIdx = 0;
    userAnswers = {};
    timeLeft = 2400;
    isExamStarted = true;

    document.getElementById('examBeforeStart').style.display = 'none';
    document.getElementById('cardBox').style.display = 'flex';
    document.getElementById('totalIdx').style.display = 'inline';

    document.getElementById('examStartBox').style.display = 'none';
    document.getElementById('timerBox').style.display = 'block';
    document.getElementById('btnGroup').style.display = 'flex';
    document.getElementById('resultContent').style.display = 'none';
    document.getElementById('quizContent').style.display = 'flex';

    startTimer();
    loadQ();
};

function resetExamSetup() {
    isExamStarted = false;
    clearInterval(timerInterval);
    userAnswers = {};
    
    document.getElementById('examBeforeStart').style.display = 'flex';
    document.getElementById('cardBox').style.display = 'none';
    document.getElementById('totalIdx').style.display = 'none';

    document.getElementById('resultContent').style.display = 'none';
    document.getElementById('examStartBox').style.display = 'flex';
    document.getElementById('timerBox').style.display = 'none';
    document.getElementById('btnGroup').style.display = 'none';
    document.getElementById('quizContent').style.display = 'none';

    updateExamFilterCounts();
}
window.resetExamSetup = resetExamSetup;

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("시험 시간이 종료되었습니다.");
            window.submitExam();
        } else {
            timeLeft--;
            updateTimerDisplay();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const s = (timeLeft % 60).toString().padStart(2, '0');
    document.getElementById('timerBox').innerText = `⏱️ ${m}:${s}`;
}

window.submitExam = function() {
    const totalExamQ = examDb.length;
    if (Object.keys(userAnswers).length < totalExamQ) {
        if (!confirm(`아직 안 푼 문제가 있습니다. 정말 제출하시겠습니까?`)) return;
    }

    clearInterval(timerInterval);
    isExamStarted = false;

    let correctCount = 0;
    let autoCompletedCount = 0;
    let autoRemovedCount = 0;

    examDb.forEach((item, idx) => {
        const userAnsArr = userAnswers[idx] || [];
        const isCorrect = item.answers.length === userAnsArr.length && item.answers.every(a => userAnsArr.includes(a));
        const qId = item._id;

        let curStreak = streakMap[qId] || 0;

        if (isCorrect) {
            correctCount++;
            wrongSet.delete(qId);

            curStreak = curStreak > 0 ? curStreak + 1 : 1;
            streakMap[qId] = curStreak;

            if (curStreak >= 3 && !memorizedSet.has(qId)) {
                memorizedSet.add(qId);
                autoCompletedCount++;
            }
        } else {
            wrongSet.add(qId);

            curStreak = curStreak < 0 ? curStreak - 1 : -1;
            streakMap[qId] = curStreak;

            if (curStreak <= -3 && memorizedSet.has(qId)) {
                memorizedSet.delete(qId);
                autoRemovedCount++;
            }
        }
    });

    saveUserData();
    updateExamFilterCounts();

    const score = Math.round((correctCount / totalExamQ) * 100);

    document.getElementById('quizContent').style.display = 'none';
    document.getElementById('btnGroup').style.display = 'none';
    document.getElementById('timerBox').style.display = 'none';
    
    const resultContent = document.getElementById('resultContent');
    const scoreText = document.getElementById('scoreText');
    const passText = document.getElementById('passText');

    resultContent.style.display = 'block';
    scoreText.innerText = `${score}점`;

    if (score >= 70) {
        scoreText.className = 'result-score pass';
        passText.className = 'pass';
        passText.innerText = '🎉 1종/2종 보통 합격!';
    } else if (score >= 60) {
        scoreText.className = 'result-score pass';
        passText.className = 'pass';
        passText.innerText = '🎉 2종 보통 합격 (1종 불합격)';
    } else {
        scoreText.className = 'result-score fail';
        passText.className = 'fail';
        passText.innerText = '💥 불합격입니다.';
    }

    document.getElementById('resultDetail').innerText = `총 ${totalExamQ}문제 중 ${correctCount}문제를 맞히셨습니다.`;

    if (autoCompletedCount > 0 && autoRemovedCount > 0) {
        showToast(`🎉 ${autoCompletedCount}개 문제 자동 암기 완료! / ⚠️ ${autoRemovedCount}개 문제 암기 해제`, 4000);
    } else if (autoCompletedCount > 0) {
        showToast(`🎉 3회 연속 정답! ${autoCompletedCount}개 문제가 자동으로 암기 완료되었습니다.`, 4000);
    } else if (autoRemovedCount > 0) {
        showToast(`⚠️ 3회 연속 오답으로 ${autoRemovedCount}개 문제가 암기 목록에서 제외되었습니다.`, 4000);
    }
};