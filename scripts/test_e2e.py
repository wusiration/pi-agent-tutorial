#!/usr/bin/env python3
"""
端到端测试：验证 SSE 事件流完整性
"""

import requests
import json
import sys

BASE_URL = "http://localhost:3000"

def test_health():
    """测试健康检查"""
    r = requests.get(f"{BASE_URL}/api/health")
    print(f"Health: {r.status_code} {r.json()}")
    assert r.status_code == 200

def test_create_session():
    """测试创建会话"""
    r = requests.post(f"{BASE_URL}/api/sessions")
    print(f"Create session: {r.status_code} {r.json()}")
    assert r.status_code == 200
    return r.json()["sessionId"]

def test_chat_sse(session_id: str, message: str, use_mock: bool = True):
    """测试 SSE 聊天流"""
    print(f"\n=== Testing chat: '{message}' (mock={use_mock}) ===")
    
    events = []
    
    with requests.post(
        f"{BASE_URL}/api/chat",
        json={"message": message, "sessionId": session_id, "useMock": use_mock},
        stream=True,
        timeout=30
    ) as r:
        print(f"Response status: {r.status_code}")
        print(f"Response headers: {dict(r.headers)}")
        
        for line in r.iter_lines():
            if not line:
                continue
            line = line.decode('utf-8')
            print(f"Raw line: {line[:200]}")
            
            if line.startswith('data: '):
                data = line[6:]
                if not data:
                    continue
                try:
                    event = json.loads(data)
                    events.append(event)
                    print(f"Event: {event['type']}")
                except json.JSONDecodeError as e:
                    print(f"Parse error: {e} for data: {data[:100]}")
    
    print(f"\nTotal events: {len(events)}")
    event_types = [e['type'] for e in events]
    print(f"Event sequence: {event_types}")
    
    # 验证基本事件序列
    assert events[0]['type'] == 'agent_start', f"First event should be agent_start, got {events[0]['type']}"
    assert events[-1]['type'] in ('agent_end', 'agent_error'), f"Last event should be agent_end or agent_error, got {events[-1]['type']}"
    
    return events

def main():
    print("=" * 60)
    print("Pi Agent E2E Test")
    print("=" * 60)
    
    # 1. 健康检查
    test_health()
    
    # 2. 创建会话
    session_id = test_create_session()
    print(f"Session ID: {session_id}")
    
    # 3. 测试普通文本对话
    events1 = test_chat_sse(session_id, "Hello", use_mock=True)
    
    # 4. 测试工具调用（天气）
    events2 = test_chat_sse(session_id, "北京天气怎么样？", use_mock=True)
    
    # 5. 测试工具调用（计算）
    events3 = test_chat_sse(session_id, "计算 123 * 456", use_mock=True)
    
    print("\n" + "=" * 60)
    print("All tests passed!")
    print("=" * 60)

if __name__ == "__main__":
    main()
