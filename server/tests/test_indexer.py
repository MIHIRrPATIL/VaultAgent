import asyncio
from indexer import indexer

async def main():
    result = await indexer.scan_vault("/tmp/test_vault", excludes={"secret.md"})
    print("Scan Result:", result)
    print("Neighbors of test1:", indexer.get_neighbors("test1"))
    print("Neighbors of test2:", indexer.get_neighbors("test2"))
    print("Top nodes:", indexer.get_top_nodes())
    print("Orphans:", indexer.get_orphans())

asyncio.run(main())
