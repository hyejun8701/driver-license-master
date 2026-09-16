let db = []; 
let activeDb = []; 
let examDb = []; 

let memorizeIdx = 0;
let examIdx = 0;
let currentMode = 'memorize'; 
let isExamStarted = false;
let isAnimating = false;
let hideMemorized = true;

let memorizedSet = new Set(JSON.parse(localStorage.getItem('memorized_questions') || '[]'));
// 오답 노트: 문제 ID별 맞힌 횟수 저장 객체 (3번 이상 맞혀야 완전 탈출)
let incorrectCounts = JSON.parse(localStorage.getItem('incorrect_counts') || '{}');

let userAnswers = {}; 
let timerInterval = null;
let timeLeft = 2400; 

let dragStartX = 0;
let dragEndX = 0;
let isMouseDown = false;

const cardBox = document.getElementById('cardBox');

window.addEventListener('DOMContentLoaded', () => {
    loadJsonData();

    ['qInput', 'rangeStart', 'rangeEnd'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            let originalVal = '';

            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (id === 'qInput') jumpToQ();
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
            });
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
            document.getElementById('loading').innerHTML = `
                <div style="font-weight: bold; color: #ef4444; line-height: 1.4; font-size: 0.85rem;">
                    ⚠️ questions_full.json 데이터를 불러오지 못했습니다.<br>수동으로 선택해 주세요.
                </div>
                <button class="file-select-btn" onclick="triggerFileInput()">📁 파일 선택</button>
                <input type="file" id="jsonFileInput" accept=".json" onchange="handleFileUpload(event)" style="display: none;">
            `;
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

function showSwipeGuide(force = false) {
    if (force || !localStorage.getItem('swipe_guide_shown')) {
        const toast = document.getElementById('toastMsg');
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
        localStorage.setItem('swipe_guide_shown', 'true');
    }
}

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
    const curIdx = getCurIdx();

    if (dir === 'next' && curIdx >= list.length - 1) {
        if (currentMode === 'exam') {
            submitExam();
        } else {
            alert('마지막 문제입니다.');
        }
        return;
    }
    if (dir === 'prev' && curIdx <= 0) return;

    isAnimating = true;

    const outClass = dir === 'next' ? 'slide-out-left' : 'slide-out-right';
    const inClass = dir === 'next' ? 'slide-in-from-right' : 'slide-in-from-left';

    cardBox.classList.add(outClass);

    setTimeout(() => {
        if (dir === 'next') setCurIdx(curIdx + 1);
        else setCurIdx(curIdx - 1);
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

function triggerFileInput() {
    const input = document.getElementById('jsonFileInput');
    if (input) input.click();
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            initQuiz(data);
        } catch (err) {
            alert("올바른 JSON 파일이 아닙니다.");
        }
    };
    reader.readAsText(file);
}

function initQuiz(data) {
    db = data.map((item, idx) => ({ ...item, _id: item.id || idx + 1 }));
    document.getElementById('loading').style.display = 'none';

    if (db.length) {
        document.getElementById('rangeStart').value = 1;
        document.getElementById('rangeEnd').value = db.length;
    }

    updateActiveDb();
    updateProgressBar();
    switchMode(currentMode); 
    showSwipeGuide();
}

function updateActiveDb() {
    if (hideMemorized) {
        activeDb = db.filter(item => !memorizedSet.has(item._id));
    } else {
        activeDb = [...db];
    }
}

function updateProgressBar() {
    const total = db.length;
    const memorizedCount = memorizedSet.size;
    const percent = total > 0 ? Math.round((memorizedCount / total) * 100) : 0;

    document.getElementById('memorizedCountText').innerText = memorizedCount;
    document.getElementById('totalCountText').innerText = total;
    document.getElementById('memorizedPercentText').innerText = `${percent}%`;
    document.getElementById('progressBarFill').style.width = `${percent}%`;
}

function toggleHideMemorized() {
    hideMemorized = document.getElementById('hideMemorizedCheck').checked;
    updateActiveDb();
    memorizeIdx = 0;
    loadQ();
}

function toggleItemMemorized(isChecked) {
    const list = getCurList();
    if (!list.length) return;

    const currentItem = list[getCurIdx()];
    if (!currentItem) return;

    if (isChecked) {
        memorizedSet.add(currentItem._id);
    } else {
        memorizedSet.delete(currentItem._id);
    }

    localStorage.setItem('memorized_questions', JSON.stringify(Array.from(memorizedSet)));
    updateProgressBar();

    if (currentMode === 'memorize' && hideMemorized && isChecked) {
        updateActiveDb();
        if (memorizeIdx >= activeDb.length) memorizeIdx = Math.max(0, activeDb.length - 1);
        loadQ();
    }
}

function switchMode(mode) {
    if (currentMode === 'exam' && isExamStarted && mode === 'memorize') {
        const confirmLeave = confirm("⚠️ 진행 중이던 모의고사가 중단되고 초기화됩니다.\n정말 암기장으로 이동하시겠습니까?");
        if (!confirmLeave) return; 
    }

    currentMode = mode;
    document.getElementById('tabMemorize').classList.toggle('active', mode === 'memorize');
    document.getElementById('tabExam').classList.toggle('active', mode === 'exam');

    const progressSection = document.getElementById('progressSection');
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

        progressSection.style.display = 'block';
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
            updateProgressBar();
            loadQ();
        }
    } else {
        progressSection.style.display = 'none';
        navLeft.style.display = 'none';
        totalIdxEl.style.display = 'none'; 
        resetExamSetup();
    }
}

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

function jumpToQ() {
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
}

function startNewExam() {
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
    } else if (filterType === 'incorrect') {
        // 오답 노트: 아직 3번 미만으로 맞혀서 오답인 문제들만 필터링
        pool = pool.filter(item => {
            const count = incorrectCounts[item._id] || 0;
            return count < 3 && incorrectCounts[item._id] !== undefined;
        });
    }

    const selectedCount = parseInt(document.getElementById('examCountSelect').value || 40);

    if (pool.length < selectedCount) {
        if (filterType === 'incorrect') {
            alert(`선택한 범위 내 '오답 문제'가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)\n3번 완벽히 맞힐 때까지 오답에 유지됩니다!`);
        } else if (filterType === 'memorized') {
            alert(`선택한 범위 내 '외운 문제'가 부족합니다. (현재 ${pool.length}개 / 필요 ${selectedCount}개)`);
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
}

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
}

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("시험 시간이 종료되었습니다.");
            submitExam();
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

function submitExam() {
    const totalExamQ = examDb.length;
    if (Object.keys(userAnswers).length < totalExamQ) {
        if (!confirm(`아직 안 푼 문제가 있습니다. 정말 제출하시겠습니까?`)) return;
    }

    clearInterval(timerInterval);
    isExamStarted = false;

    let correctCount = 0;
    examDb.forEach((item, idx) => {
        const userAnsArr = userAnswers[idx] || [];
        const isCorrect = item.answers.length === userAnsArr.length && item.answers.every(a => userAnsArr.includes(a));
        
        if (isCorrect) {
            correctCount++;
            // 맞힌 경우: 오답 노트에 있던 문제라면 맞힌 횟수 1 증가 (3번 채우면 완전 삭제)
            if (incorrectCounts[item._id] !== undefined) {
                incorrectCounts[item._id]++;
                if (incorrectCounts[item._id] >= 3) {
                    delete incorrectCounts[item._id];
                }
            }
        } else {
            // 틀린 경우: 오답 노트에 없었다면 새로 추가 (0회 맞힘 상태)
            if (incorrectCounts[item._id] === undefined) {
                incorrectCounts[item._id] = 0;
            }
        }
    });

    // 변경된 오답 횟수 저장
    localStorage.setItem('incorrect_counts', JSON.stringify(incorrectCounts));

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
}
