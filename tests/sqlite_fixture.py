"""SQLite fixtures must close handles before Windows can remove their files."""
import sqlite3
class FixtureConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()
def connect(*args,**kwargs):
    kwargs.setdefault('factory',FixtureConnection)
    return sqlite3.connect(*args,**kwargs)
