"""
数据库迁移脚本：添加AI提供商支持字段

这个脚本为agents表添加多提供商支持的字段，包括OpenAI、Anthropic、Google和Azure OpenAI。
"""

import sqlite3
import os

def migrate():
    # 尝试多个可能的数据库路径
    possible_paths = [
        "/app/data/basjoo.db",  # Docker环境
        "./test.db",             # 本地开发环境
        "./data/basjoo.db",      # 本地开发环境
        "../data/basjoo.db",     # 本地开发环境
    ]

    db_path = None
    for path in possible_paths:
        if os.path.exists(path):
            db_path = path
            break

    if not db_path:
        print(f"数据库文件不存在，尝试的路径: {possible_paths}")
        return False

    print(f"开始迁移数据库: {db_path}")

    # 备份数据库
    backup_path = db_path + ".before_provider_fields"
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        # 检查是否需要迁移
        if "provider_type" in columns:
            print("提供商字段已存在，跳过迁移")
            return True

        # 开始添加新字段
        print("正在添加提供商支持字段...")

        # 1. provider_type (ENUM)
        print("  添加 provider_type...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN provider_type VARCHAR(20) DEFAULT 'openai'
        """)

        # 2. Azure OpenAI 特定字段
        print("  添加 azure_endpoint...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN azure_endpoint VARCHAR(500)
        """)

        print("  添加 azure_deployment_name...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN azure_deployment_name VARCHAR(100)
        """)

        print("  添加 azure_api_version...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN azure_api_version VARCHAR(20)
        """)

        # 3. Anthropic 特定字段
        print("  添加 anthropic_version...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN anthropic_version VARCHAR(20)
        """)

        # 4. Google 特定字段
        print("  添加 google_project_id...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN google_project_id VARCHAR(100)
        """)

        print("  添加 google_region...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN google_region VARCHAR(50)
        """)

        # 5. 通用提供商配置
        print("  添加 provider_config...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN provider_config JSON
        """)

        # 6. 修改后的系统预设
        print("  添加 modified_system_presets...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN modified_system_presets JSON
        """)

        # 提交事务
        conn.commit()
        print("✅ 迁移完成！")

        # 验证新字段
        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        print(f"agents表现在有 {len(new_columns)} 个字段")

        # 验证特定字段
        required_fields = [
            "provider_type",
            "azure_endpoint",
            "azure_deployment_name",
            "azure_api_version",
            "anthropic_version",
            "google_project_id",
            "google_region",
            "provider_config",
            "modified_system_presets"
        ]

        for field in required_fields:
            if field in new_columns:
                print(f"  ✓ {field} 已添加")
            else:
                print(f"  ✗ {field} 缺失！")

        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        # 恢复备份
        shutil.copy2(backup_path, db_path)
        print(f"已从备份恢复数据库")
        return False

    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
